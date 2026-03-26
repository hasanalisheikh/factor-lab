from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import os
import platform
import signal
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable

import numpy as np
import pandas as pd
import requests
import yfinance as yf

from .ml import run_walk_forward
from .supabase_io import DataIngestJob, Job, SupabaseIO

# ---------------------------------------------------------------------------
# Job-level wall-clock timeout (prevents stuck/runaway jobs)
# ---------------------------------------------------------------------------
_JOB_TIMEOUT_SECONDS: int = int(os.getenv("JOB_TIMEOUT_SECONDS", "600"))  # 10 min
_ML_RIDGE_JOB_TIMEOUT_SECONDS: int = int(
    os.getenv("JOB_TIMEOUT_SECONDS_ML_RIDGE", str(max(_JOB_TIMEOUT_SECONDS, 900)))
)
_ML_LIGHTGBM_JOB_TIMEOUT_SECONDS: int = int(
    os.getenv("JOB_TIMEOUT_SECONDS_ML_LIGHTGBM", str(max(_JOB_TIMEOUT_SECONDS, 1800)))
)

ProgressCallback = Callable[[str, int], None]

DEFAULT_ETF8_UNIVERSE = ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utc_today_str() -> str:
    return _utcnow().strftime("%Y-%m-%d")


def _job_timeout_seconds_for_strategy(strategy_id: str) -> int:
    if strategy_id == "ml_lightgbm":
        return _ML_LIGHTGBM_JOB_TIMEOUT_SECONDS
    if strategy_id == "ml_ridge":
        return _ML_RIDGE_JOB_TIMEOUT_SECONDS
    return _JOB_TIMEOUT_SECONDS


# ---------------------------------------------------------------------------
# Backtest window requirements
# ---------------------------------------------------------------------------
MIN_SPAN_DAYS: int = 730  # 2 calendar years
MIN_DATA_POINTS: int = 500  # ~2 years of daily trading data

# ---------------------------------------------------------------------------
# Strategy-specific constants
# ---------------------------------------------------------------------------
_LOW_VOL_WINDOW: int = 60  # 60 trading-day realized vol window
_TREND_SMA_WINDOW: int = 200  # 200-day benchmark SMA for trend signal
_TREND_DEFENSIVE: str = "TLT"  # Primary risk-off asset
_TREND_DEFENSIVE_FALLBACK: str = "BIL"  # Cash-proxy fallback

# Data-ingest safeguards
_INGEST_HTTP_TIMEOUT_SECONDS: int = 25
_INGEST_ATTEMPT_TIMEOUT_SECONDS: int = 45
_INGEST_MAX_RETRIES: int = 3
_INGEST_BACKOFF_SECONDS: tuple[int, ...] = (1, 2, 4)

# Static preset baskets used for run-level reproducibility. These can be updated
# later without changing the resolution precedence contract.
UNIVERSE_PRESETS: dict[str, list[str]] = {
    "ETF8": DEFAULT_ETF8_UNIVERSE,
    "SP100": [
        "AAPL",
        "MSFT",
        "AMZN",
        "GOOGL",
        "GOOG",
        "META",
        "NVDA",
        "BRK-B",
        "JPM",
        "XOM",
        "UNH",
        "JNJ",
        "PG",
        "V",
        "MA",
        "HD",
        "COST",
        "ABBV",
        "PEP",
        "MRK",
    ],
    "NASDAQ100": [
        "AAPL",
        "MSFT",
        "NVDA",
        "AMZN",
        "META",
        "GOOGL",
        "GOOG",
        "AVGO",
        "COST",
        "TSLA",
        "NFLX",
        "AMD",
        "ADBE",
        "CSCO",
        "PEP",
        "INTC",
        "QCOM",
        "AMGN",
        "TXN",
        "CMCSA",
    ],
}


@dataclass(frozen=True)
class BacktestResult:
    equity_rows: list[dict[str, Any]]
    metrics: dict[str, float]
    feature_rows: list[dict[str, Any]] | None = None
    prediction_rows: list[dict[str, Any]] | None = None
    model_metadata: dict[str, Any] | None = None
    position_rows: list[dict[str, Any]] | None = None


def validate_backtest_window(
    dates: list[Any],
    min_span_days: int = MIN_SPAN_DAYS,
    min_data_points: int = MIN_DATA_POINTS,
) -> tuple[bool, str]:
    """Validate that a backtest has sufficient history.

    Checks:
      - At least ``min_data_points`` data points (default 500, ~2 yr daily).
      - At least ``min_span_days`` calendar days between first and last date
        (default 730, 2 years).

    Detects monthly-cadence data (median inter-date gap > 20 days) and adjusts
    the count-failure message to note that the 500-point guideline targets daily
    data.

    Returns:
      (ok, reason): ok=True when all checks pass; reason is empty on success.
    """
    n = len(dates)
    if n == 0:
        return False, (
            "No data points produced. Ensure data coverage for the requested date range."
        )

    ts_dates = sorted(pd.Timestamp(d) for d in dates)
    span_days = (ts_dates[-1] - ts_dates[0]).days if n >= 2 else 0

    # Detect daily vs monthly cadence from median inter-date gap.
    is_monthly = False
    if n >= 4:
        gaps = [(ts_dates[i] - ts_dates[i - 1]).days for i in range(1, min(n, 11))]
        median_gap = sorted(gaps)[len(gaps) // 2]
        is_monthly = median_gap > 20

    if n < min_data_points:
        cadence_note = (
            (
                f" Note: the {min_data_points}-point guideline applies to daily data; "
                "monthly backtests require a much longer time span to accumulate that many observations."
            )
            if is_monthly
            else ""
        )
        return False, (
            f"Insufficient data: {n} data points (need >= {min_data_points}).{cadence_note} "
            "Choose a longer date range or ensure data ingestion coverage."
        ).strip()

    if span_days < min_span_days:
        return False, (
            f"Backtest span is {span_days} days ({span_days / 365:.1f} years), "
            f"but at least {min_span_days} days (2 years) are required for a robust backtest. "
            "Choose an earlier start date or extend your date range."
        )

    return True, ""


def _to_date(value: str) -> pd.Timestamp:
    ts = pd.to_datetime(value, utc=False)
    return pd.Timestamp(ts.date())


def _subtract_calendar_days(value: str, days: int) -> str:
    if days <= 0:
        return value
    return (pd.to_datetime(value) - pd.Timedelta(days=days)).strftime("%Y-%m-%d")


def _baseline_warmup_calendar_days(strategy_id: str) -> int:
    if strategy_id == "momentum_12_1":
        return 390
    if strategy_id == "low_vol":
        return 90
    if strategy_id == "trend_filter":
        # Trend Filter needs both the benchmark SMA warmup and the risk-on momentum lookback.
        return 390
    return 0


def _slice_frame_to_run_window(frame: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    mask = (frame.index >= pd.Timestamp(start)) & (frame.index <= pd.Timestamp(end))
    return frame.loc[mask].copy()


def _slice_series_to_run_window(series: pd.Series, start: str, end: str) -> pd.Series:
    mask = (series.index >= pd.Timestamp(start)) & (series.index <= pd.Timestamp(end))
    window = series.loc[mask].copy()
    if not window.empty:
        window.iloc[0] = 0.0
    return window


def _slice_positions_to_run_window(
    rows: list[dict[str, Any]],
    start: str,
    end: str,
) -> list[dict[str, Any]]:
    return [row for row in rows if start <= str(row.get("date", "")) <= end]


def _annualize_turnover_from_rebalances(rebalance_turnover: pd.Series) -> float:
    positive = rebalance_turnover[rebalance_turnover > 0]
    return float(positive.mean() * 12.0) if len(positive) > 0 else 0.0


def _normalize_symbol_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = values.split(",")
    if not isinstance(values, (list, tuple)):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        symbol = str(raw).strip().upper()
        if not symbol or symbol in seen:
            continue
        normalized.append(symbol)
        seen.add(symbol)
    return normalized


def _extract_run_universe_preset(run: dict[str, Any]) -> str | None:
    universe = run.get("universe")
    if isinstance(universe, str) and universe.strip():
        return universe.strip().upper()

    run_params = run.get("run_params")
    if isinstance(run_params, dict):
        nested = run_params.get("universe")
        if isinstance(nested, str) and nested.strip():
            return nested.strip().upper()
    return None


def resolve_universe_symbols(run: dict[str, Any]) -> list[str]:
    snapshot_symbols = _normalize_symbol_list(run.get("universe_symbols"))
    if snapshot_symbols:
        return snapshot_symbols

    preset_name = _extract_run_universe_preset(run)
    if preset_name and preset_name in UNIVERSE_PRESETS:
        return list(UNIVERSE_PRESETS[preset_name])

    env_value = (os.getenv("FACTORLAB_UNIVERSE") or "").strip()
    if env_value:
        env_key = env_value.upper()
        if env_key in UNIVERSE_PRESETS:
            return list(UNIVERSE_PRESETS[env_key])
        env_symbols = _normalize_symbol_list(env_value)
        if env_symbols:
            return env_symbols

    return list(DEFAULT_ETF8_UNIVERSE)


def resolve_and_snapshot_universe_symbols(io: SupabaseIO, run: dict[str, Any]) -> list[str]:
    symbols = resolve_universe_symbols(run)
    if not _normalize_symbol_list(run.get("universe_symbols")):
        io.update_run_universe_symbols(run["id"], symbols)
        run["universe_symbols"] = list(symbols)
    return symbols


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


def _get_ticker_inception_dates(prices: pd.DataFrame) -> dict[str, pd.Timestamp]:
    """Return the first date with a non-NaN price for each column in the prices frame."""
    inception: dict[str, pd.Timestamp] = {}
    for col in prices.columns:
        valid = prices[col].dropna()
        if not valid.empty:
            inception[col] = valid.index[0]
    return inception


def _equal_weight(prices: pd.DataFrame) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    # Compute per-ticker inception dates so pre-launch tickers are excluded at each rebalance.
    inception_dates = _get_ticker_inception_dates(prices)

    rets = prices.pct_change().fillna(0.0)
    portfolio_rets = pd.Series(0.0, index=prices.index)
    monthly_turnover = pd.Series(0.0, index=prices.index)
    rebalance_mask = (
        prices.index.to_series()
        .dt.to_period("M")
        .ne(prices.index.to_series().shift(1).dt.to_period("M"))
    )
    monthly_turnover.loc[rebalance_mask.values] = 0.08
    annualized_turnover = float(monthly_turnover[monthly_turnover > 0].mean() * 12.0)

    # Collect rebalance-date positions (first day of each month), excluding pre-inception tickers.
    rebalance_positions: list[dict[str, Any]] = []
    prev_month = None
    prev_weights: pd.Series = pd.Series(0.0, index=prices.columns)

    for dt in prices.index:
        current_month = dt.to_period("M")
        if current_month != prev_month:
            prev_month = current_month
            # Available = tickers that have launched by this rebalance date
            available_cols = [col for col in prices.columns if inception_dates.get(col, dt) <= dt]
            n = len(available_cols)
            weight_per_asset = 1.0 / n if n > 0 else 0.0
            current_w = pd.Series(0.0, index=prices.columns)
            if n > 0:
                current_w.loc[available_cols] = weight_per_asset
            prev_weights = current_w

            for col in available_cols:
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": str(col),
                        "weight": weight_per_asset,
                    }
                )

        # Daily portfolio return using weights set at last rebalance
        portfolio_rets.loc[dt] = float((rets.loc[dt] * prev_weights).sum())

    return portfolio_rets, annualized_turnover, monthly_turnover, rebalance_positions


def _momentum_12_1(
    prices: pd.DataFrame,
    top_n: int | None = None,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    asset_rets = prices.pct_change().fillna(0.0)
    scores = prices.shift(21) / prices.shift(252) - 1.0

    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    n_assets = prices.shape[1]
    # Use provided top_n if given; default to top-half of universe (legacy behaviour).
    effective_top_n = max(1, min(int(top_n), n_assets) if top_n is not None else n_assets // 2)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            # dropna() is inception-aware: tickers with insufficient lookback history
            # (including pre-launch tickers) return NaN scores and are excluded naturally.
            s = scores.loc[dt].dropna()
            s = s[s > 0].sort_values(ascending=False).head(effective_top_n)
            current_w = pd.Series(0.0, index=prices.columns)
            if not s.empty:
                current_w.loc[s.index] = 1.0 / len(s)
            rebalance_turnover.loc[dt] = float(
                (current_w - prev_rebalance_weights).abs().sum() / 2.0
            )
            prev_rebalance_weights = current_w.copy()

            # Snapshot positions at this rebalance date
            for sym, wt in current_w[current_w > 0].items():
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": str(sym),
                        "weight": float(wt),
                    }
                )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    annualized_turnover = float(rebalance_turnover[rebalance_turnover > 0].mean() * 12.0)
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions


def _low_vol(
    prices: pd.DataFrame,
    top_n: int,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    """Low Volatility: select the top_n assets with the lowest 60-day realized vol each month."""
    if prices.shape[0] < _LOW_VOL_WINDOW:
        raise ValueError(
            f"Low Volatility strategy requires at least {_LOW_VOL_WINDOW} daily data points "
            "to compute 60-day realized volatility. Choose a longer date range."
        )

    asset_rets = prices.pct_change().fillna(0.0)
    vol_60 = asset_rets.rolling(_LOW_VOL_WINDOW).std(ddof=0)

    n_assets = prices.shape[1]
    top_n_clamped = min(max(1, top_n), n_assets)

    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            vols = vol_60.loc[dt].dropna().sort_values(ascending=True)
            selected = vols.head(top_n_clamped)
            current_w = pd.Series(0.0, index=prices.columns)
            if not selected.empty:
                current_w.loc[selected.index] = 1.0 / len(selected)
            rebalance_turnover.loc[dt] = float(
                (current_w - prev_rebalance_weights).abs().sum() / 2.0
            )
            prev_rebalance_weights = current_w.copy()
            for sym, wt in current_w[current_w > 0].items():
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": str(sym),
                        "weight": float(wt),
                    }
                )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    pos_turnover = rebalance_turnover[rebalance_turnover > 0]
    annualized_turnover = float(pos_turnover.mean() * 12.0) if len(pos_turnover) > 0 else 0.0
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions


def _trend_filter(
    prices: pd.DataFrame,
    universe_tickers: list[str],
    benchmark_ticker: str,
    defensive_ticker: str,
    top_n: int | None = None,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    """Trend Filter: risk-on (Momentum 12-1) when benchmark > SMA-200; risk-off (TLT) otherwise."""
    if benchmark_ticker not in prices.columns:
        raise ValueError(f"Benchmark ticker {benchmark_ticker!r} not found in price data.")
    if defensive_ticker not in prices.columns:
        raise ValueError(
            f"Defensive ticker {defensive_ticker!r} not available for risk-off allocation. "
            "Ensure TLT or BIL data is ingested for the requested date range."
        )

    bench = prices[benchmark_ticker]
    n_bench_valid = int(bench.dropna().shape[0])
    if n_bench_valid < _TREND_SMA_WINDOW:
        raise ValueError(
            f"Trend Filter strategy requires at least {_TREND_SMA_WINDOW} daily benchmark data points "
            f"to compute the 200-day SMA. Got {n_bench_valid} points. "
            "Choose a longer date range or earlier start date."
        )

    bench_sma200 = bench.rolling(_TREND_SMA_WINDOW).mean()

    universe_cols = [c for c in universe_tickers if c in prices.columns]
    if not universe_cols:
        raise ValueError("No universe tickers found in price data.")

    universe_prices = prices[universe_cols]
    # Momentum 12-1 scores for risk-on selection (replicates _momentum_12_1 logic)
    scores = universe_prices.shift(21) / universe_prices.shift(252) - 1.0
    # Use provided top_n if given; default to top-half of universe (legacy behaviour).
    n_universe = len(universe_cols)
    top_n_risk_on = max(1, min(int(top_n), n_universe) if top_n is not None else n_universe // 2)

    asset_rets = prices.pct_change().fillna(0.0)
    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            bench_val = bench.loc[dt]
            sma_val = bench_sma200.loc[dt]
            risk_on = bool(
                pd.notna(bench_val) and pd.notna(sma_val) and float(bench_val) > float(sma_val)
            )
            current_w = pd.Series(0.0, index=prices.columns)
            if risk_on:
                s = scores.loc[dt].dropna()
                s = s[s > 0].sort_values(ascending=False).head(top_n_risk_on)
                if not s.empty:
                    current_w.loc[s.index] = 1.0 / len(s)
                else:
                    # No positive momentum signal: fall back to equal-weight universe
                    current_w.loc[universe_cols] = 1.0 / len(universe_cols)
            else:
                # Risk-off: 100% defensive asset
                current_w.loc[defensive_ticker] = 1.0
            rebalance_turnover.loc[dt] = float(
                (current_w - prev_rebalance_weights).abs().sum() / 2.0
            )
            prev_rebalance_weights = current_w.copy()
            for sym, wt in current_w[current_w > 0].items():
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": str(sym),
                        "weight": float(wt),
                    }
                )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    pos_turnover = rebalance_turnover[rebalance_turnover > 0]
    annualized_turnover = float(pos_turnover.mean() * 12.0) if len(pos_turnover) > 0 else 0.0
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions


def _apply_rebalance_costs(
    returns: pd.Series, rebalance_turnover: pd.Series, costs_bps: float
) -> pd.Series:
    cost_rate = max(float(costs_bps), 0.0) / 10_000.0
    if cost_rate <= 0:
        return returns

    aligned = rebalance_turnover.reindex(returns.index).fillna(0.0)
    net = returns.copy()
    for dt, t in aligned.items():
        if t > 0:
            net.at[dt] = float(net.at[dt]) - cost_rate * float(t)
    return net


def _compute_metrics(daily_returns: pd.Series, turnover: float) -> dict[str, float]:
    daily_returns = daily_returns.replace([np.inf, -np.inf], np.nan).dropna()
    if daily_returns.empty:
        raise ValueError("No returns available")

    mean_daily = float(daily_returns.mean())
    vol_daily = float(daily_returns.std(ddof=0))
    volatility = vol_daily * np.sqrt(252.0)
    sharpe = (mean_daily / vol_daily) * np.sqrt(252.0) if vol_daily > 1e-10 else 0.0

    equity = (1.0 + daily_returns).cumprod()
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    max_drawdown = float(drawdown.min())

    n = len(daily_returns)
    cagr = float(equity.iloc[-1] ** (252.0 / n) - 1.0) if n > 0 else 0.0
    calmar = cagr / abs(max_drawdown) if max_drawdown < 0 else 0.0
    win_rate = float((daily_returns > 0).mean())

    gains = float(daily_returns[daily_returns > 0].sum())
    losses = float(abs(daily_returns[daily_returns < 0].sum()))
    profit_factor = gains / losses if losses > 0 else 0.0

    return {
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown,
        "turnover": float(turnover),
        "volatility": volatility,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "calmar": calmar,
    }


def _equity_rows(
    dates: pd.Index, portfolio: pd.Series, benchmark: pd.Series
) -> list[dict[str, Any]]:
    aligned_dates = (
        pd.Index(dates).intersection(portfolio.index).intersection(benchmark.index).sort_values()
    )
    rows: list[dict[str, Any]] = []
    for dt in aligned_dates:
        rows.append(
            {
                "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                "portfolio": float(portfolio.loc[dt]),
                "benchmark": float(benchmark.loc[dt]),
            }
        )
    return rows


def _rows_digest(rows: list[dict[str, Any]] | None, *, keys: list[str]) -> str | None:
    if not rows:
        return None
    normalized: list[dict[str, Any]] = []
    for row in rows:
        normalized.append({k: row.get(k) for k in keys})
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _validate_backtest_result(result: BacktestResult, run_id: str) -> None:
    """Raise RuntimeError if any required output is missing.

    Prevents a run from being marked 'completed' when the DB would be left in a
    partially-written state (e.g. missing metrics, empty equity curve, no positions).
    """
    missing: list[str] = []

    if not result.equity_rows:
        missing.append("equity_curve (no rows produced)")
    else:
        has_benchmark = any(row.get("benchmark") is not None for row in result.equity_rows)
        if not has_benchmark:
            missing.append("equity_curve.benchmark (all benchmark values are null)")

    if not result.position_rows:
        missing.append("positions (no rebalance rows produced)")

    required_keys = {
        "cagr",
        "sharpe",
        "max_drawdown",
        "turnover",
        "volatility",
        "win_rate",
        "profit_factor",
        "calmar",
    }
    if not result.metrics:
        missing.append("metrics (empty)")
    else:
        absent = required_keys - set(result.metrics.keys())
        if absent:
            missing.append(f"metrics missing keys: {sorted(absent)}")

    if missing:
        raise RuntimeError(
            f"[run={run_id}] Backtest finished but required outputs are missing: "
            + ", ".join(missing)
            + ". Run marked failed to prevent silent data loss."
        )


def _build_run_metadata(run: dict[str, Any], result: BacktestResult) -> dict[str, Any]:
    strategy = str(run.get("strategy_id", ""))
    model_metadata = result.model_metadata or {}
    model_params = model_metadata.get("model_params", {})
    if not isinstance(model_params, dict):
        model_params = {}
    requested_model_impl: str | None = None
    if strategy == "ml_ridge":
        requested_model_impl = "ridge"
    elif strategy == "ml_lightgbm":
        requested_model_impl = "lightgbm"

    model_impl = str(model_params.get("model_impl") or requested_model_impl or "n/a")
    train_start = model_metadata.get("train_start")
    train_end = model_metadata.get("train_end")
    feature_set = model_params.get("feature_set")

    return {
        "strategy_requested": strategy,
        "model_impl": model_impl,
        "model_name": str(model_metadata.get("model_name") or strategy),
        "model_version": model_params.get("model_version"),
        "feature_set": feature_set,
        "training_window": {
            "start": train_start,
            "end": train_end,
            "min_train_months": (
                model_params.get("training_window", {}).get("min_train_months")
                if isinstance(model_params.get("training_window"), dict)
                else None
            ),
        },
        "positions_digest": _rows_digest(
            result.position_rows,
            keys=["date", "symbol", "weight"],
        ),
        "equity_digest": _rows_digest(
            result.equity_rows,
            keys=["date", "portfolio", "benchmark"],
        ),
    }


def _build_baseline_result(
    io: SupabaseIO,
    run: dict[str, Any],
    *,
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    universe_tickers = resolve_universe_symbols(run)
    tickers = list(universe_tickers)
    benchmark_ticker_raw = _resolve_run_benchmark_ticker(run)
    if benchmark_ticker_raw not in tickers:
        tickers = [*tickers, benchmark_ticker_raw]

    strat = run["strategy_id"]
    costs_bps = float(run.get("costs_bps") or 0.0)
    top_n = int(run.get("top_n") or 5)
    run_start = str(run["start_date"])
    run_end = str(run["end_date"])
    warmup_start = _subtract_calendar_days(run_start, _baseline_warmup_calendar_days(strat))

    # trend_filter needs the defensive ticker in the price data
    defensive_ticker: str | None = None
    if strat == "trend_filter":
        defensive_ticker = _TREND_DEFENSIVE
        if defensive_ticker not in tickers:
            tickers = [*tickers, defensive_ticker]

    if on_progress:
        on_progress("load_data", 20)
    prices = io.fetch_prices_frame(tickers, warmup_start, run_end)
    _prices_stale = (
        prices.empty
        or prices.shape[0] < 40
        or prices.index.max() < pd.Timestamp(run_end) - pd.Timedelta(days=5)
    )
    if _prices_stale:
        prices = _download_prices(warmup_start, run_end, tickers)

    # For trend_filter: if defensive ticker still missing, try BIL fallback
    if (
        strat == "trend_filter"
        and defensive_ticker is not None
        and defensive_ticker not in prices.columns
    ):
        fallback = _TREND_DEFENSIVE_FALLBACK
        tickers_fb = [t for t in tickers if t != defensive_ticker] + [fallback]
        try:
            prices_fb = _download_prices(warmup_start, run_end, tickers_fb)
            if fallback in prices_fb.columns:
                defensive_ticker = fallback
                prices = prices_fb
            else:
                raise ValueError(
                    f"Trend Filter requires a defensive asset for risk-off allocation. "
                    f"Tried {_TREND_DEFENSIVE!r} and {_TREND_DEFENSIVE_FALLBACK!r} but neither "
                    "was available. Check data coverage for the requested date range."
                )
        except RuntimeError as exc:
            raise ValueError(
                f"Trend Filter requires {_TREND_DEFENSIVE!r} or {_TREND_DEFENSIVE_FALLBACK!r} "
                f"for risk-off allocation, but download failed: {exc}"
            ) from exc

    run_window_prices = _slice_frame_to_run_window(prices, run_start, run_end)
    _ensure_min_history(run_window_prices, context=f"run {run['id']} strategy {strat}")
    bench_col = _select_available_benchmark_ticker(benchmark_ticker_raw, prices.columns)

    if on_progress:
        on_progress("compute_signals", 40)
    # Slice prices to investable universe only. The full `prices` frame may
    # contain the benchmark ticker (added so equity-curve math works) and the
    # trend-filter defensive asset (TLT/BIL). Passing the wider frame to
    # equal_weight / momentum / low_vol would make those strategies hold the
    # benchmark as a portfolio asset, which is incorrect.
    universe_prices = prices[[c for c in universe_tickers if c in prices.columns]]
    rebalance_positions: list[dict[str, Any]] = []
    if strat == "equal_weight":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _equal_weight(
            universe_prices
        )
    elif strat == "momentum_12_1":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _momentum_12_1(
            universe_prices, top_n
        )
    elif strat == "low_vol":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _low_vol(
            universe_prices, top_n
        )
    elif strat == "trend_filter":
        assert defensive_ticker is not None
        daily_rets, _, rebalance_turnover, rebalance_positions = _trend_filter(
            prices, universe_tickers, bench_col, defensive_ticker, top_n
        )
    else:
        raise ValueError(f"Unsupported baseline strategy: {strat}")

    if on_progress:
        on_progress("rebalance", 60)
    daily_rets = _apply_rebalance_costs(daily_rets, rebalance_turnover, costs_bps)
    daily_rets = _slice_series_to_run_window(daily_rets, run_start, run_end)
    rebalance_turnover = _slice_series_to_run_window(rebalance_turnover, run_start, run_end)
    benchmark_rets = _slice_series_to_run_window(
        prices[bench_col].pct_change().fillna(0.0),
        run_start,
        run_end,
    )

    portfolio = 100_000.0 * (1.0 + daily_rets).cumprod()
    benchmark = 100_000.0 * (1.0 + benchmark_rets.reindex(portfolio.index).fillna(0.0)).cumprod()
    rows = _equity_rows(portfolio.index, portfolio, benchmark)

    if on_progress:
        on_progress("metrics", 78)
    metrics = _compute_metrics(
        daily_rets,
        _annualize_turnover_from_rebalances(rebalance_turnover),
    )

    # Attach run_id to each position row
    position_rows: list[dict[str, Any]] = [
        {"run_id": run["id"], **p}
        for p in _slice_positions_to_run_window(rebalance_positions, run_start, run_end)
    ]
    return BacktestResult(equity_rows=rows, metrics=metrics, position_rows=position_rows)


def _build_ml_result(
    io: SupabaseIO,
    run: dict[str, Any],
    *,
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    tickers = resolve_universe_symbols(run)
    requested_benchmark = _resolve_run_benchmark_ticker(run)
    if requested_benchmark not in tickers:
        tickers = [requested_benchmark, *tickers]

    warmup_years = int(os.getenv("ML_WARMUP_YEARS", "5"))
    warmup_start = (pd.to_datetime(run["start_date"]) - pd.DateOffset(years=warmup_years)).strftime(
        "%Y-%m-%d"
    )

    if on_progress:
        on_progress("load_data", 15)
    prices = io.fetch_prices_frame(tickers, warmup_start, run["end_date"])
    available_columns = set(str(c) for c in prices.columns)
    missing_tickers = [t for t in tickers if t not in available_columns]
    has_benchmark = requested_benchmark in available_columns
    has_non_benchmark = any(t != requested_benchmark and t in available_columns for t in tickers)
    needs_download = (
        prices.empty
        or prices.shape[0] < 260
        or not has_benchmark
        or not has_non_benchmark
        or bool(missing_tickers)
        or prices.index.max() < pd.Timestamp(run["end_date"]) - pd.Timedelta(days=5)
    )
    if needs_download:
        prices = _download_prices(warmup_start, run["end_date"], tickers)

    # Hard guard: ML requires at least one investable (non-benchmark) symbol.
    investable = [
        t for t in tickers if t != requested_benchmark and t in set(str(c) for c in prices.columns)
    ]
    if not investable:
        raise ValueError(
            "ML run aborted: no non-benchmark universe symbols are available in price data. "
            "Ingest the selected universe or choose a different universe."
        )
    _ensure_min_history(prices, context=f"run {run['id']} strategy {run['strategy_id']}")

    if on_progress:
        on_progress("features", 30)
    benchmark_ticker = _select_available_benchmark_ticker(requested_benchmark, prices.columns)

    top_n_raw = int(run.get("top_n") or 10)
    top_n_for_ml = max(1, min(top_n_raw, len(investable)))
    if top_n_for_ml < top_n_raw:
        print(
            f"[engine][ml] run={run['id']} top_n clamped {top_n_raw}→{top_n_for_ml} "
            f"(universe has {len(investable)} investable symbols)"
        )

    if on_progress:
        on_progress("train", 75)
    last_train_progress = 75

    def ml_progress(processed_steps: int, total_steps: int) -> None:
        nonlocal last_train_progress
        if not on_progress or total_steps <= 0:
            return
        next_progress = 75 + min(14, int((processed_steps / total_steps) * 14))
        if next_progress <= last_train_progress and processed_steps < total_steps:
            return
        last_train_progress = next_progress
        on_progress("train", next_progress)

    ml = run_walk_forward(
        run_id=run["id"],
        strategy=run["strategy_id"],
        prices=prices,
        start_date=run["start_date"],
        end_date=run["end_date"],
        benchmark_ticker=benchmark_ticker,
        top_n=top_n_for_ml,
        cost_bps=float(run.get("costs_bps") or 10.0),
        progress_cb=ml_progress,
    )
    model_params = (ml.metadata or {}).get("model_params", {})
    if not isinstance(model_params, dict):
        model_params = {}
    expected_impl = "ridge" if run["strategy_id"] == "ml_ridge" else "lightgbm"
    actual_impl = str(model_params.get("model_impl") or "")
    if actual_impl != expected_impl:
        raise RuntimeError(
            f"ML strategy dispatch mismatch: requested={run['strategy_id']} "
            f"expected_impl={expected_impl} actual_impl={actual_impl or 'n/a'}"
        )
    if len(ml.prediction_rows) == 0:
        raise RuntimeError(
            f"ML strategy {run['strategy_id']} produced no predictions. "
            "Run aborted to avoid silent fallback or degenerate output."
        )
    return BacktestResult(
        equity_rows=ml.equity_rows,
        metrics=ml.metrics,
        feature_rows=ml.feature_rows,
        prediction_rows=ml.prediction_rows,
        model_metadata=ml.metadata,
        position_rows=ml.position_rows,
    )


def _run_backtest(
    io: SupabaseIO,
    run: dict[str, Any],
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    strategy = run["strategy_id"]
    if strategy in {"equal_weight", "momentum_12_1", "low_vol", "trend_filter"}:
        return _build_baseline_result(io, run, on_progress=on_progress)
    if strategy in {"ml_ridge", "ml_lightgbm"}:
        return _build_ml_result(io, run, on_progress=on_progress)

    raise ValueError(f"Unsupported strategy: {strategy}")


_BLOCKED_ERROR_PATTERNS: list[str] = [
    "no timezone found for ticker",
    "no price data available",
    "possibly delisted",
    "no data found for ticker",
    "symbol not found",
    "invalid ticker",
    "404",
    "403 forbidden",
]


def _classify_ingest_error(error: str) -> str:
    """Classify an ingest exception as 'blocked' (permanent) or 'retriable' (transient).

    'blocked' errors indicate a permanent issue (invalid ticker, delisted symbol, etc.)
    and should not be retried automatically. 'retriable' errors are transient (network,
    timeout) and will be scheduled for automatic retry with exponential backoff.
    """
    lower = error.lower()
    for pattern in _BLOCKED_ERROR_PATTERNS:
        if pattern in lower:
            return "blocked"
    return "retriable"


def _download_data_ingest_prices(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    return yf.download(
        tickers=[ticker],
        start=start_date,
        end=(pd.to_datetime(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
        threads=False,
        timeout=_INGEST_HTTP_TIMEOUT_SECONDS,
    )


def _download_data_ingest_with_retry(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    last_exc: Exception | None = None
    for attempt in range(1, _INGEST_MAX_RETRIES + 1):
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_download_data_ingest_prices, ticker, start_date, end_date)
                return future.result(timeout=_INGEST_ATTEMPT_TIMEOUT_SECONDS)
        except Exception as exc:
            last_exc = exc
            if attempt >= _INGEST_MAX_RETRIES:
                break
            backoff = _INGEST_BACKOFF_SECONDS[min(attempt - 1, len(_INGEST_BACKOFF_SECONDS) - 1)]
            time.sleep(backoff)

    raise RuntimeError(
        f"download failed after {_INGEST_MAX_RETRIES} attempts: {last_exc}"
    ) from last_exc


def _download_stooq_prices(ticker: str, start_date: str, end_date: str) -> pd.Series:
    """Fallback price download from stooq.com via direct CSV fetch.

    Only called when FACTORLAB_FALLBACK_PROVIDER=stooq and the primary yfinance
    download returns sparse data (<50% of expected business days).

    Stooq symbol convention: lowercase + '.us' suffix; hyphens become dots
    (e.g., BRK-B → brk.b.us). Returns an empty Series on any error.
    """
    stooq_sym = ticker.replace("-", ".").lower() + ".us"
    d1 = start_date.replace("-", "")
    d2 = end_date.replace("-", "")
    url = f"https://stooq.com/q/d/l/?s={stooq_sym}&d1={d1}&d2={d2}&i=d"
    try:
        resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        text = resp.text.strip()
        if not text or "No data" in text or len(text) < 60:
            return pd.Series(dtype=float)
        df = pd.read_csv(io.StringIO(text), parse_dates=["Date"], index_col="Date")
        if "Close" not in df.columns:
            return pd.Series(dtype=float)
        return df["Close"].sort_index().dropna()
    except Exception as exc:
        print(f"[engine] stooq fallback failed for {ticker}: {exc}")
        return pd.Series(dtype=float)


def _fetch_existing_price_bounds(io: SupabaseIO, ticker: str) -> tuple[str | None, str | None]:
    """Return the earliest/latest stored price dates for a ticker."""
    try:
        latest_result = (
            io.client.table("prices")
            .select("date")
            .eq("ticker", ticker)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        existing_latest = latest_result.data[0]["date"] if latest_result.data else None
    except Exception:
        existing_latest = None

    try:
        earliest_result = (
            io.client.table("prices")
            .select("date")
            .eq("ticker", ticker)
            .order("date")
            .limit(1)
            .execute()
        )
        existing_earliest = earliest_result.data[0]["date"] if earliest_result.data else None
    except Exception:
        existing_earliest = None

    return existing_earliest, existing_latest


def _resolve_incremental_ingest_window(
    requested_start: str,
    requested_end: str,
    *,
    existing_earliest: str | None,
    existing_latest: str | None,
) -> tuple[str, str, bool]:
    """Resolve the effective download window for an incremental ingest request."""
    requested_start_ts = pd.Timestamp(requested_start)
    requested_end_ts = pd.Timestamp(requested_end)

    if existing_latest:
        existing_latest_ts = pd.Timestamp(existing_latest)
        next_day_ts = existing_latest_ts + pd.Timedelta(days=1)

        historical_gap_end_ts: pd.Timestamp | None = None
        if existing_earliest:
            existing_earliest_ts = pd.Timestamp(existing_earliest)
            if existing_earliest_ts > requested_start_ts:
                historical_gap_end_ts = min(
                    requested_end_ts,
                    existing_earliest_ts - pd.Timedelta(days=1),
                )
                if historical_gap_end_ts < requested_start_ts:
                    historical_gap_end_ts = None

        if next_day_ts > requested_end_ts:
            if historical_gap_end_ts is not None:
                return (
                    requested_start,
                    historical_gap_end_ts.strftime("%Y-%m-%d"),
                    False,
                )
            return existing_latest, existing_latest, True

        if requested_start_ts > existing_latest_ts:
            return next_day_ts.strftime("%Y-%m-%d"), requested_end, False

    return requested_start, requested_end, False


def _process_data_ingest_job(io: SupabaseIO, job: Job) -> None:
    """Download and upsert historical prices for a single benchmark ticker."""
    started = _utcnow()
    payload = job.payload or {}
    ticker = str(payload.get("ticker", "")).strip().upper()
    if not ticker:
        io.save_failure(
            job,
            0,
            "[stage=download] data_ingest job is missing ticker in payload",
            stage="download",
        )
        return

    default_start = "1993-01-01"
    start_date = str(payload.get("start_date", default_start))
    end_date = str(payload.get("end_date", _utc_today_str()))

    # Wrap all blocking work in a heartbeat context so the stall scanner can
    # distinguish an alive job from a crashed one (heartbeat fires every 10 s).
    with _Heartbeat(lambda: io.heartbeat_job(job.id), interval=10, job_id=job.id):
        existing_earliest, existing_latest = _fetch_existing_price_bounds(io, ticker)
        start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
            start_date,
            end_date,
            existing_earliest=existing_earliest,
            existing_latest=existing_latest,
        )
        if is_fully_covered:
            duration = int((_utcnow() - started).total_seconds())
            io.save_data_ingest_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=0,
                start_date=existing_latest,
                end_date=existing_latest,
            )
            print(
                f"[engine] data_ingest skipped job={job.id} {ticker} already current ({existing_latest})"
            )
            return

        print(f"[engine] data_ingest job={job.id} ticker={ticker} {start_date}→{end_date}")
        stage = "download"
        try:
            io.update_job_progress(job.id, stage=stage, progress=15)

            # Download without the 40-row guard used by backtests — incremental updates
            # may legitimately produce only a handful of new rows.
            raw = _download_data_ingest_with_retry(ticker, start_date, end_date)
            if raw.empty:
                # No new trading days in range (e.g. weekend/holiday at end of window).
                duration = int((_utcnow() - started).total_seconds())
                actual = existing_latest or start_date
                io.update_job_progress(job.id, stage="finalize", progress=95)
                io.save_data_ingest_success(
                    job=job,
                    duration_seconds=duration,
                    tickers_updated=1,
                    rows_upserted=0,
                    start_date=actual,
                    end_date=actual,
                )
                print(f"[engine] data_ingest completed job={job.id} no new rows")
                return

            # Normalise to a Series of close prices.
            stage = "transform"
            io.update_job_progress(job.id, stage=stage, progress=45)
            if isinstance(raw.columns, pd.MultiIndex):
                level0 = raw.columns.get_level_values(0)
                key = "Close" if "Close" in level0 else "Adj Close"
                close_raw = raw[key]
                close_series = (
                    close_raw.iloc[:, 0] if isinstance(close_raw, pd.DataFrame) else close_raw
                )
            else:
                close_series = raw.iloc[:, 0]
            close_series = close_series.sort_index().ffill().dropna()

            # Build upsert rows
            stage = "upsert_prices"
            io.update_job_progress(job.id, stage=stage, progress=70)
            price_rows: list[dict[str, Any]] = []
            for dt, val in close_series.items():
                if pd.isna(val):
                    continue
                price_rows.append(
                    {
                        "ticker": ticker,
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "adj_close": float(val),
                    }
                )

            # Upsert in larger chunks to reduce Supabase round-trips
            chunk_size = 5000
            for i in range(0, len(price_rows), chunk_size):
                chunk = price_rows[i : i + chunk_size]
                io.client.table("prices").upsert(chunk, on_conflict="ticker,date").execute()

            stage = "finalize"
            io.update_job_progress(job.id, stage=stage, progress=95)

            duration = int((_utcnow() - started).total_seconds())
            actual_start = price_rows[0]["date"] if price_rows else start_date
            actual_end = price_rows[-1]["date"] if price_rows else end_date
            io.save_data_ingest_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=len(price_rows),
                start_date=actual_start,
                end_date=actual_end,
            )
            print(
                f"[engine] data_ingest completed job={job.id} {len(price_rows)} rows in {duration}s"
            )
        except Exception as exc:
            duration = int((_utcnow() - started).total_seconds())
            err_str = f"[stage={stage}] {exc}"
            # Log first so the error is always visible even if the DB write fails.
            print(f"[engine] data_ingest failed job={job.id} in {duration}s: {exc}")
            classification = _classify_ingest_error(str(exc))
            if classification == "blocked":
                io.save_blocked(job, duration, err_str, stage=stage)
                print(f"[engine] data_ingest BLOCKED job={job.id} (permanent): {exc}")
            else:
                io.save_data_ingest_failure_with_retry(job, duration, err_str, stage=stage)


def _make_year_chunks(start_date: str, end_date: str) -> list[tuple[str, str]]:
    """Split a date range into year-sized chunks.

    Prevents yfinance from hanging on 10+ year requests by downloading year by
    year. Returns a list of (chunk_start, chunk_end) YYYY-MM-DD tuples.
    Single-year or shorter ranges return one chunk (no overhead).
    """
    chunks: list[tuple[str, str]] = []
    chunk_start = pd.Timestamp(start_date)
    end_ts = pd.Timestamp(end_date)
    while chunk_start <= end_ts:
        # Advance by one year, then back one day to avoid overlap
        chunk_end = min(
            chunk_start + pd.DateOffset(years=1) - pd.Timedelta(days=1),
            end_ts,
        )
        chunks.append((chunk_start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        chunk_start = chunk_end + pd.Timedelta(days=1)
    return chunks if chunks else [(start_date, end_date)]


def _extract_close_series(raw: "pd.DataFrame") -> "pd.Series":
    """Extract and clean the close price series from a yfinance DataFrame."""
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = raw.columns.get_level_values(0)
        key = "Close" if "Close" in level0 else "Adj Close"
        close_raw = raw[key]
        close_series = close_raw.iloc[:, 0] if isinstance(close_raw, pd.DataFrame) else close_raw
    else:
        close_series = raw.iloc[:, 0]
    return close_series.sort_index().ffill().dropna()


def _process_data_ingest_job_v2(io: SupabaseIO, job: DataIngestJob) -> None:
    """Download and upsert historical prices for a data_ingest_jobs row.

    Uses the dedicated data_ingest_jobs table (explicit schema) rather than the
    generic jobs table. Heartbeat fires every 10 s via heartbeat_data_ingest_job.
    Large date ranges (> 1 year) are downloaded in year-sized chunks to prevent
    yfinance timeouts.
    """
    started = _utcnow()

    with _Heartbeat(lambda: io.heartbeat_data_ingest_job(job.id), interval=10, job_id=job.id):
        start_date = job.start_date
        end_date = job.end_date
        existing_earliest, existing_latest = _fetch_existing_price_bounds(io, job.symbol)
        start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
            start_date,
            end_date,
            existing_earliest=existing_earliest,
            existing_latest=existing_latest,
        )
        if is_fully_covered:
            duration = int((_utcnow() - started).total_seconds())
            io.update_data_ingest_progress(job.id, stage="finalize", progress=95)
            io.save_data_ingest_job_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=0,
                start_date=existing_latest,
                end_date=existing_latest,
            )
            print(
                f"[engine] data_ingest_v2 skipped job={job.id} "
                f"{job.symbol} already current ({existing_latest})"
            )
            return

        print(f"[engine] data_ingest_v2 job={job.id} symbol={job.symbol} {start_date}→{end_date}")
        stage = "download"
        try:
            io.update_data_ingest_progress(job.id, stage=stage, progress=10)

            # Split into year-sized chunks so yfinance never hangs on 10+ year requests.
            year_chunks = _make_year_chunks(start_date, end_date)
            total_chunks = len(year_chunks)
            _fallback_provider = os.getenv("FACTORLAB_FALLBACK_PROVIDER", "").strip().lower()

            all_close_series: list["pd.Series"] = []
            for chunk_idx, (c_start, c_end) in enumerate(year_chunks):
                # Progress: 10% base + up to 55% across all chunks (download phase)
                chunk_pct = 10 + int((chunk_idx / total_chunks) * 55)
                io.update_data_ingest_progress(job.id, stage=stage, progress=chunk_pct)

                raw = _download_data_ingest_with_retry(job.symbol, c_start, c_end)

                # Fallback provider: if primary data is absent/sparse, try stooq.
                # Controlled by FACTORLAB_FALLBACK_PROVIDER=stooq env var.
                if _fallback_provider == "stooq":
                    primary_rows = (
                        0
                        if raw.empty
                        else (
                            len(raw[raw.columns[0]].dropna())
                            if isinstance(raw.columns, pd.MultiIndex)
                            else len(raw.dropna())
                        )
                    )
                    expected_bdays = max(
                        1, int((pd.to_datetime(c_end) - pd.to_datetime(c_start)).days * 5 / 7)
                    )
                    if primary_rows < expected_bdays * 0.5:
                        print(
                            f"[engine] primary sparse ({primary_rows}/{expected_bdays} rows), "
                            f"trying stooq fallback for {job.symbol} {c_start}→{c_end}"
                        )
                        fallback_series = _download_stooq_prices(job.symbol, c_start, c_end)
                        if not fallback_series.empty:
                            if raw.empty:
                                primary_series = pd.Series(dtype=float)
                            else:
                                primary_series = _extract_close_series(raw)
                            merged = primary_series.combine_first(fallback_series)
                            raw = pd.DataFrame({"Close": merged})
                            print(
                                f"[engine] stooq merge: {len(primary_series)} primary + "
                                f"{len(fallback_series) - len(primary_series.reindex(fallback_series.index).dropna())} "
                                f"fallback = {len(raw)} total"
                            )

                if not raw.empty:
                    all_close_series.append(_extract_close_series(raw))

            if not all_close_series:
                duration = int((_utcnow() - started).total_seconds())
                actual = existing_latest or start_date
                io.update_data_ingest_progress(job.id, stage="finalize", progress=95)
                io.save_data_ingest_job_success(
                    job=job,
                    duration_seconds=duration,
                    tickers_updated=1,
                    rows_upserted=0,
                    start_date=actual,
                    end_date=actual,
                )
                print(f"[engine] data_ingest_v2 completed job={job.id} no new rows")
                return

            stage = "transform"
            io.update_data_ingest_progress(job.id, stage=stage, progress=70)
            # Concatenate all year-chunk series, de-duplicate dates, forward-fill
            close_series = pd.concat(all_close_series).sort_index()
            close_series = (
                close_series[~close_series.index.duplicated(keep="last")].ffill().dropna()
            )

            stage = "upsert"
            io.update_data_ingest_progress(job.id, stage=stage, progress=80)
            price_rows: list[dict[str, Any]] = []
            for dt, val in close_series.items():
                if pd.isna(val):
                    continue
                price_rows.append(
                    {
                        "ticker": job.symbol,
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "adj_close": float(val),
                    }
                )

            chunk_size = 5000
            for i in range(0, len(price_rows), chunk_size):
                chunk = price_rows[i : i + chunk_size]
                io.client.table("prices").upsert(chunk, on_conflict="ticker,date").execute()

            stage = "finalize"
            io.update_data_ingest_progress(job.id, stage=stage, progress=95)

            duration = int((_utcnow() - started).total_seconds())
            actual_start = price_rows[0]["date"] if price_rows else start_date
            actual_end = price_rows[-1]["date"] if price_rows else end_date
            io.save_data_ingest_job_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=len(price_rows),
                start_date=actual_start,
                end_date=actual_end,
            )
            print(
                f"[engine] data_ingest_v2 completed job={job.id} "
                f"{len(price_rows)} rows in {duration}s"
            )
        except Exception as exc:
            duration = int((_utcnow() - started).total_seconds())
            err_str = f"[stage={stage}] {exc}"
            print(f"[engine] data_ingest_v2 failed job={job.id} in {duration}s: {exc}")
            classification = _classify_ingest_error(str(exc))
            if classification == "blocked":
                io.save_data_ingest_job_blocked(job, duration, err_str, stage=stage)
                print(f"[engine] data_ingest_v2 BLOCKED job={job.id} (permanent): {exc}")
            else:
                io.save_data_ingest_job_failure_with_retry(job, duration, err_str, stage=stage)


def _install_job_timeout(seconds: int) -> None:
    """Install a SIGALRM-based wall-clock timeout for the current process (POSIX only)."""
    if platform.system() == "Windows":
        return

    def _handler(signum: int, frame: object) -> None:
        raise RuntimeError(
            f"Job exceeded maximum runtime of {seconds}s ({seconds // 60} min). "
            "The backtest or model training took too long and was aborted. "
            "Try a shorter date range or a lighter-weight strategy."
        )

    signal.signal(signal.SIGALRM, _handler)
    signal.alarm(seconds)


def _cancel_job_timeout() -> None:
    """Cancel any pending SIGALRM timeout."""
    if platform.system() == "Windows":
        return
    signal.alarm(0)


class _Heartbeat:
    """Background daemon thread that calls a heartbeat function every `interval` seconds.

    Usage:
        with _Heartbeat(lambda: io.heartbeat_job(job_id), interval=10):
            # blocking work — heartbeat fires every interval seconds

    The thread is a daemon so it never prevents worker shutdown.
    Any exception in the heartbeat thread is swallowed — a failed heartbeat
    must never kill an in-progress job.
    """

    def __init__(
        self,
        beat_fn: "Callable[[], None]",
        interval: int = 15,
        *,
        job_id: str = "",
    ) -> None:
        self._beat_fn = beat_fn
        self._interval = interval
        self._job_id = job_id
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "_Heartbeat":
        def _run() -> None:
            while not self._stop.wait(timeout=self._interval):
                try:
                    self._beat_fn()
                except Exception:
                    pass  # swallow — a failed heartbeat must never kill the job

        name = f"heartbeat-{self._job_id[:8]}" if self._job_id else "heartbeat"
        self._thread = threading.Thread(target=_run, daemon=True, name=name)
        self._thread.start()
        return self

    def __exit__(self, *args: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval + 2)


def _process_job(io: SupabaseIO, job: Job) -> None:
    if not io.claim_job(job):
        return

    if job.job_type == "data_ingest":
        _process_data_ingest_job(io, job)
        # Chain to backtest if this was the last preflight ingest job for a waiting run
        io.try_chain_preflight_backtest(job)
        return

    started = _utcnow()
    run = io.fetch_run(job.run_id)  # type: ignore[arg-type]
    if run is None:
        raise RuntimeError(f"Run not found for run_id={job.run_id}")
    job_timeout_seconds = _job_timeout_seconds_for_strategy(str(run.get("strategy_id", "")))
    print(f"[engine] running job={job.id} run={job.run_id} timeout={job_timeout_seconds}s")
    _install_job_timeout(job_timeout_seconds)
    try:
        io.update_job_progress(job.id, stage="ingest", progress=10)
        resolve_and_snapshot_universe_symbols(io, run)

        # Early span validation — fast-fail before any data fetch or computation.
        try:
            start_dt = pd.to_datetime(run["start_date"])
            end_dt = pd.to_datetime(run["end_date"])
            requested_span = (end_dt - start_dt).days
        except Exception:
            requested_span = 0
        if requested_span < MIN_SPAN_DAYS:
            raise ValueError(
                f"Requested date range is too short: {requested_span} days "
                f"({requested_span / 365:.1f} years). "
                f"A robust backtest requires at least {MIN_SPAN_DAYS} days (2 years). "
                "Please choose an earlier start date."
            )

        # Progress callback: updates job stage/progress via DB during computation.
        def progress_cb(stage: str, pct: int) -> None:
            io.update_job_progress(job.id, stage=stage, progress=pct)

        result = _run_backtest(io, run, progress_cb)

        assert job.run_id is not None

        # Validate all required outputs are present before marking as completed.
        _validate_backtest_result(result, job.run_id)

        progress_cb("persist", 82)
        io.update_run_metadata(job.run_id, _build_run_metadata(run, result))
        progress_cb("persist", 88)

        duration = int((_utcnow() - started).total_seconds())
        io.save_success(
            job=job,
            duration_seconds=duration,
            metrics=result.metrics,
            equity_rows=({"run_id": job.run_id, **row} for row in result.equity_rows),
            feature_rows=result.feature_rows,
            prediction_rows=result.prediction_rows,
            model_metadata=result.model_metadata,
            position_rows=result.position_rows,
        )
        _cancel_job_timeout()
        print(f"[engine] completed job={job.id} in {duration}s")
    except Exception as exc:
        _cancel_job_timeout()
        duration = int((_utcnow() - started).total_seconds())
        err_str = str(exc)
        # Print first — so the error is always visible in logs even if the DB write fails.
        print(f"[engine] failed job={job.id} in {duration}s: {err_str}")
        try:
            io.save_failure(job, duration, err_str)
        except Exception as save_exc:
            print(f"[engine] CRITICAL: could not persist failure for job={job.id}: {save_exc}")


# ---------------------------------------------------------------------------
# HTTP trigger server — lets Vercel/any caller wake the worker immediately
# ---------------------------------------------------------------------------
_wakeup = threading.Event()


class _TriggerHandler(BaseHTTPRequestHandler):
    _secret: str = os.getenv("WORKER_TRIGGER_SECRET", "")

    def do_GET(self) -> None:
        if self.path == "/health":
            self._respond(200, b"ok")
        else:
            self._respond(404, b"not found")

    def do_POST(self) -> None:
        if self.path != "/trigger":
            self._respond(404, b"not found")
            return
        if self._secret:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {self._secret}":
                self._respond(401, b"unauthorized")
                return
        _wakeup.set()
        self._respond(200, b"ok")

    def _respond(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass  # suppress access logs


def _start_trigger_server(port: int) -> None:
    server = HTTPServer(("0.0.0.0", port), _TriggerHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[engine] trigger server on :{port}")


def main() -> None:
    once = os.getenv("RUN_ONCE", "").lower() in ("1", "true", "yes")
    poll_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
    batch_size = int(os.getenv("JOB_BATCH_SIZE", "3"))
    port = int(os.getenv("PORT", "8000"))
    job_stall_minutes = int(os.getenv("JOB_STALL_MINUTES", "15"))
    job_queue_timeout_minutes = int(os.getenv("JOB_QUEUED_TIMEOUT_MINUTES", "10"))

    if not once:
        _start_trigger_server(port)

    io = SupabaseIO()
    print("[engine] worker started")
    while True:
        # --- Watchdog & retry scheduler (run before fetching new work) ---
        # jobs table (backtest + legacy data_ingest jobs)
        io.scan_and_requeue_stalled_jobs(stall_minutes=job_stall_minutes, max_attempts=5)
        io.scan_and_requeue_queued_too_long(
            timeout_minutes=job_queue_timeout_minutes, max_attempts=5
        )
        io.requeue_due_for_retry(max_attempts=5)
        # data_ingest_jobs table (new explicit-schema ingest jobs)
        io.scan_stalled_data_ingest_jobs(stall_minutes=2, max_attempts=5)
        io.scan_queued_too_long_data_ingest(timeout_minutes=10, max_attempts=5)
        io.requeue_due_data_ingest(max_attempts=5)

        # Fetch from both queues and process
        jobs = io.fetch_queued_jobs(limit=batch_size)
        ingest_jobs = io.fetch_queued_data_ingest_jobs(limit=batch_size)

        if not jobs and not ingest_jobs:
            if once:
                print("[engine] no more queued jobs — exiting")
                break
            _wakeup.wait(timeout=poll_seconds)
            _wakeup.clear()
            continue

        _wakeup.clear()
        for job in jobs:
            _process_job(io, job)
        for ingest_job in ingest_jobs:
            if io.claim_data_ingest_job(ingest_job):
                _process_data_ingest_job_v2(io, ingest_job)


if __name__ == "__main__":
    main()
