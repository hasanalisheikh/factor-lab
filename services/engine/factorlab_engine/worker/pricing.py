from __future__ import annotations

import os
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from factorlab_engine.supabase_io import SupabaseIO

from .progress import _compute_metrics, _equity_rows
from .settings import MIN_DATA_POINTS, MIN_SPAN_DAYS, BacktestResult, _to_date


def _build_synthetic_result(start: str, end: str, seed: int = 7) -> BacktestResult:
    dates = pd.bdate_range(_to_date(start), _to_date(end))
    if len(dates) < 2:
        raise ValueError("Date range is too small for a run")

    rng = np.random.default_rng(seed)
    daily_r = rng.normal(loc=0.0003, scale=0.008, size=len(dates))
    bench_r = rng.normal(loc=0.0002, scale=0.006, size=len(dates))

    portfolio = 100_000.0 * pd.Series(1.0 + daily_r, index=dates).cumprod()
    benchmark = 100_000.0 * pd.Series(1.0 + bench_r, index=dates).cumprod()

    metrics = _compute_metrics(pd.Series(daily_r, index=dates), turnover=0.12)
    rows = _equity_rows(dates, portfolio, benchmark)
    return BacktestResult(equity_rows=rows, metrics=metrics)


def _resolve_run_benchmark_ticker(run: dict[str, Any]) -> str:
    raw = run.get("benchmark") or run.get("benchmark_ticker") or os.getenv("FACTORLAB_BENCHMARK")
    ticker = str(raw or "SPY").strip().upper()
    return ticker or "SPY"


def _select_available_benchmark_ticker(requested: str, columns: pd.Index) -> str:
    if requested in columns:
        return requested
    if "SPY" in columns:
        return "SPY"
    return str(columns[0])


def _download_prices(start: str, end: str, tickers: list[str]) -> pd.DataFrame:
    raw = yf.download(
        tickers=tickers,
        start=start,
        end=(pd.to_datetime(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
        threads=False,
    )
    if raw.empty:
        raise RuntimeError("No price data returned from yfinance")

    if isinstance(raw.columns, pd.MultiIndex):
        if ("Close" in raw.columns.get_level_values(0)) or (
            "Adj Close" in raw.columns.get_level_values(0)
        ):
            close_key = "Close" if "Close" in raw.columns.get_level_values(0) else "Adj Close"
            close = raw[close_key]
        else:
            close = raw.xs(raw.columns.levels[0][0], axis=1, level=0)
    else:
        close = raw.to_frame(name=tickers[0])

    if isinstance(close, pd.Series):
        close = close.to_frame(name=tickers[0])

    close = close.sort_index().ffill().dropna(how="all")
    if close.shape[0] < 40:
        raise RuntimeError("Insufficient data points for baseline strategy")
    return close


def _persist_prices_to_db(io: SupabaseIO, prices: pd.DataFrame) -> None:
    """Persist a wide prices DataFrame to the DB so subsequent runs use consistent data."""
    price_rows: list[dict[str, Any]] = []
    for ticker in prices.columns:
        for dt, val in prices[ticker].items():
            if pd.isna(val):
                continue
            price_rows.append(
                {
                    "ticker": str(ticker),
                    "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                    "adj_close": float(val),
                }
            )
    chunk_size = 5000
    for i in range(0, len(price_rows), chunk_size):
        io.client.table("prices").upsert(
            price_rows[i : i + chunk_size], on_conflict="ticker,date"
        ).execute()
    print(f"[engine] persisted {len(price_rows)} yfinance fallback price rows to DB")


def _ensure_min_history(prices: pd.DataFrame, *, context: str) -> None:
    if prices.empty:
        raise ValueError(f"No price history available for {context}")

    daily_rows = int(prices.shape[0])
    span_days = int((prices.index.max() - prices.index.min()).days) if daily_rows > 1 else 0
    if span_days < MIN_SPAN_DAYS or daily_rows < MIN_DATA_POINTS:
        raise ValueError(
            f"Insufficient history for {context}: {daily_rows} daily points across {span_days} days. "
            f"Need >= {MIN_DATA_POINTS} daily points and >= {MIN_SPAN_DAYS} days. "
            "Choose a longer date range or ingest more historical data."
        )
