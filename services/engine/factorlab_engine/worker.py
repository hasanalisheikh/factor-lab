from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from .ml import run_walk_forward
from .supabase_io import Job, SupabaseIO

DEFAULT_ETF8_UNIVERSE = ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"]

# ---------------------------------------------------------------------------
# Backtest window requirements
# ---------------------------------------------------------------------------
MIN_SPAN_DAYS: int = 730    # 2 calendar years
MIN_DATA_POINTS: int = 500  # ~2 years of daily trading data

# ---------------------------------------------------------------------------
# Strategy-specific constants
# ---------------------------------------------------------------------------
_LOW_VOL_WINDOW: int = 60          # 60 trading-day realized vol window
_TREND_SMA_WINDOW: int = 200       # 200-day benchmark SMA for trend signal
_TREND_DEFENSIVE: str = "TLT"      # Primary risk-off asset
_TREND_DEFENSIVE_FALLBACK: str = "BIL"  # Cash-proxy fallback

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
    "BRK.B",
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
      f" Note: the {min_data_points}-point guideline applies to daily data; "
      "monthly backtests require a much longer time span to accumulate that many observations."
    ) if is_monthly else ""
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


def _equal_weight(prices: pd.DataFrame) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
  rets = prices.pct_change().fillna(0.0)
  n = prices.shape[1]
  weights = np.full(n, 1.0 / n)
  portfolio_rets = (rets * weights).sum(axis=1)
  monthly_turnover = pd.Series(0.0, index=prices.index)
  rebalance_mask = prices.index.to_series().dt.to_period("M").ne(
    prices.index.to_series().shift(1).dt.to_period("M")
  )
  monthly_turnover.loc[rebalance_mask.values] = 0.08
  annualized_turnover = float(monthly_turnover[monthly_turnover > 0].mean() * 12.0)

  # Collect rebalance-date positions (first day of each month)
  weight_per_asset = 1.0 / n if n > 0 else 0.0
  rebalance_positions: list[dict[str, Any]] = []
  prev_month = None
  for dt in prices.index:
    current_month = dt.to_period("M")
    if current_month != prev_month:
      prev_month = current_month
      for col in prices.columns:
        rebalance_positions.append({
          "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
          "symbol": str(col),
          "weight": weight_per_asset,
        })

  return portfolio_rets, annualized_turnover, monthly_turnover, rebalance_positions


def _momentum_12_1(prices: pd.DataFrame) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
  asset_rets = prices.pct_change().fillna(0.0)
  scores = prices.shift(21) / prices.shift(252) - 1.0

  weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
  current_w = pd.Series(0.0, index=prices.columns)
  top_n = max(1, prices.shape[1] // 2)
  rebalance_turnover = pd.Series(0.0, index=prices.index)
  prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
  rebalance_positions: list[dict[str, Any]] = []

  for i, dt in enumerate(prices.index):
    if i == 0 or dt.month != prices.index[i - 1].month:
      s = scores.loc[dt].dropna()
      s = s[s > 0].sort_values(ascending=False).head(top_n)
      current_w = pd.Series(0.0, index=prices.columns)
      if not s.empty:
        current_w.loc[s.index] = 1.0 / len(s)
      rebalance_turnover.loc[dt] = float(
        (current_w - prev_rebalance_weights).abs().sum() / 2.0
      )
      prev_rebalance_weights = current_w.copy()

      # Snapshot positions at this rebalance date
      for sym, wt in current_w[current_w > 0].items():
        rebalance_positions.append({
          "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
          "symbol": str(sym),
          "weight": float(wt),
        })
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
        rebalance_positions.append({
          "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
          "symbol": str(sym),
          "weight": float(wt),
        })
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
  top_n_risk_on = max(1, len(universe_cols) // 2)

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
        rebalance_positions.append({
          "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
          "symbol": str(sym),
          "weight": float(wt),
        })
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
  sharpe = (mean_daily / vol_daily) * np.sqrt(252.0) if vol_daily > 0 else 0.0

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
    pd.Index(dates)
    .intersection(portfolio.index)
    .intersection(benchmark.index)
    .sort_values()
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


def _build_baseline_result(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  universe_tickers = resolve_universe_symbols(run)
  tickers = list(universe_tickers)
  benchmark_ticker_raw = _resolve_run_benchmark_ticker(run)
  if benchmark_ticker_raw not in tickers:
    tickers = [*tickers, benchmark_ticker_raw]

  strat = run["strategy_id"]
  costs_bps = float(run.get("costs_bps") or 0.0)
  top_n = int(run.get("top_n") or 5)

  # trend_filter needs the defensive ticker in the price data
  defensive_ticker: str | None = None
  if strat == "trend_filter":
    defensive_ticker = _TREND_DEFENSIVE
    if defensive_ticker not in tickers:
      tickers = [*tickers, defensive_ticker]

  prices = io.fetch_prices_frame(tickers, run["start_date"], run["end_date"])
  if prices.empty or prices.shape[0] < 40:
    prices = _download_prices(run["start_date"], run["end_date"], tickers)

  # For trend_filter: if defensive ticker still missing, try BIL fallback
  if strat == "trend_filter" and defensive_ticker is not None and defensive_ticker not in prices.columns:
    fallback = _TREND_DEFENSIVE_FALLBACK
    tickers_fb = [t for t in tickers if t != defensive_ticker] + [fallback]
    try:
      prices_fb = _download_prices(run["start_date"], run["end_date"], tickers_fb)
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

  _ensure_min_history(prices, context=f"run {run['id']} strategy {strat}")
  bench_col = _select_available_benchmark_ticker(benchmark_ticker_raw, prices.columns)

  rebalance_positions: list[dict[str, Any]] = []
  if strat == "equal_weight":
    daily_rets, turnover, rebalance_turnover, rebalance_positions = _equal_weight(prices)
  elif strat == "momentum_12_1":
    daily_rets, turnover, rebalance_turnover, rebalance_positions = _momentum_12_1(prices)
  elif strat == "low_vol":
    daily_rets, turnover, rebalance_turnover, rebalance_positions = _low_vol(prices, top_n)
  elif strat == "trend_filter":
    assert defensive_ticker is not None
    daily_rets, turnover, rebalance_turnover, rebalance_positions = _trend_filter(
      prices, universe_tickers, bench_col, defensive_ticker
    )
  else:
    raise ValueError(f"Unsupported baseline strategy: {strat}")

  daily_rets = _apply_rebalance_costs(daily_rets, rebalance_turnover, costs_bps)
  benchmark_rets = prices[bench_col].pct_change().fillna(0.0)

  portfolio = 100_000.0 * (1.0 + daily_rets).cumprod()
  benchmark = 100_000.0 * (1.0 + benchmark_rets.reindex(portfolio.index).fillna(0.0)).cumprod()
  rows = _equity_rows(portfolio.index, portfolio, benchmark)
  metrics = _compute_metrics(daily_rets, turnover)

  # Attach run_id to each position row
  position_rows: list[dict[str, Any]] = [
    {"run_id": run["id"], **p} for p in rebalance_positions
  ]
  return BacktestResult(equity_rows=rows, metrics=metrics, position_rows=position_rows)


def _build_ml_result(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  tickers = resolve_universe_symbols(run)
  requested_benchmark = _resolve_run_benchmark_ticker(run)
  if requested_benchmark not in tickers:
    tickers = [requested_benchmark, *tickers]

  warmup_years = int(os.getenv("ML_WARMUP_YEARS", "5"))
  warmup_start = (
    pd.to_datetime(run["start_date"]) - pd.DateOffset(years=warmup_years)
  ).strftime("%Y-%m-%d")

  prices = io.fetch_prices_frame(tickers, warmup_start, run["end_date"])
  if prices.empty or prices.shape[0] < 260:
    prices = _download_prices(warmup_start, run["end_date"], tickers)
  _ensure_min_history(prices, context=f"run {run['id']} strategy {run['strategy_id']}")

  benchmark_ticker = _select_available_benchmark_ticker(requested_benchmark, prices.columns)
  ml = run_walk_forward(
    run_id=run["id"],
    strategy=run["strategy_id"],
    prices=prices,
    start_date=run["start_date"],
    end_date=run["end_date"],
    benchmark_ticker=benchmark_ticker,
    top_n=int(run.get("top_n") or 10),
    cost_bps=float(run.get("costs_bps") or 10.0),
  )
  return BacktestResult(
    equity_rows=ml.equity_rows,
    metrics=ml.metrics,
    feature_rows=ml.feature_rows,
    prediction_rows=ml.prediction_rows,
    model_metadata=ml.metadata,
    position_rows=ml.position_rows,
  )


def _run_backtest(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  strategy = run["strategy_id"]
  if strategy in {"equal_weight", "momentum_12_1", "low_vol", "trend_filter"}:
    return _build_baseline_result(io, run)
  if strategy in {"ml_ridge", "ml_lightgbm"}:
    return _build_ml_result(io, run)

  raise ValueError(f"Unsupported strategy: {strategy}")


def _process_job(io: SupabaseIO, job: Job) -> None:
  if not io.claim_job(job):
    return

  started = datetime.utcnow()
  print(f"[engine] running job={job.id} run={job.run_id}")
  try:
    io.update_job_progress(job.id, stage="ingest", progress=10)
    run = io.fetch_run(job.run_id)
    if run is None:
      raise RuntimeError(f"Run not found for run_id={job.run_id}")
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

    strategy = run["strategy_id"]
    if strategy in {"ml_ridge", "ml_lightgbm"}:
      io.update_job_progress(job.id, stage="features", progress=30)
      io.update_job_progress(job.id, stage="train", progress=55)
      io.update_job_progress(job.id, stage="backtest", progress=80)
    else:
      io.update_job_progress(job.id, stage="backtest", progress=70)

    result = _run_backtest(io, run)

    io.update_job_progress(job.id, stage="report", progress=95)
    duration = int((datetime.utcnow() - started).total_seconds())
    io.save_success(
      job=job,
      duration_seconds=duration,
      metrics=result.metrics,
      equity_rows=(
        {"run_id": job.run_id, **row}
        for row in result.equity_rows
      ),
      feature_rows=result.feature_rows,
      prediction_rows=result.prediction_rows,
      model_metadata=result.model_metadata,
      position_rows=result.position_rows,
    )
    print(f"[engine] completed job={job.id} in {duration}s")
  except Exception as exc:
    duration = int((datetime.utcnow() - started).total_seconds())
    io.save_failure(job, duration, str(exc))
    print(f"[engine] failed job={job.id} in {duration}s: {exc}")


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

  if not once:
    _start_trigger_server(port)

  io = SupabaseIO()
  print("[engine] worker started")
  while True:
    jobs = io.fetch_queued_jobs(limit=batch_size)
    if not jobs:
      if once:
        print("[engine] no more queued jobs — exiting")
        break
      _wakeup.wait(timeout=poll_seconds)
      _wakeup.clear()
      continue

    _wakeup.clear()
    for job in jobs:
      _process_job(io, job)


if __name__ == "__main__":
  main()
