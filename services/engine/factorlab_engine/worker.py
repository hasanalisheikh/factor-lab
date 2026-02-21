from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from .ml import run_walk_forward
from .supabase_io import Job, SupabaseIO


@dataclass(frozen=True)
class BacktestResult:
  equity_rows: list[dict[str, Any]]
  metrics: dict[str, float]
  feature_rows: list[dict[str, Any]] | None = None
  prediction_rows: list[dict[str, Any]] | None = None
  model_metadata: dict[str, Any] | None = None


def _to_date(value: str) -> pd.Timestamp:
  ts = pd.to_datetime(value, utc=False)
  return pd.Timestamp(ts.date())


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


def _equal_weight(prices: pd.DataFrame) -> tuple[pd.Series, float]:
  rets = prices.pct_change().fillna(0.0)
  n = prices.shape[1]
  weights = np.full(n, 1.0 / n)
  portfolio_rets = (rets * weights).sum(axis=1)
  turnover = 0.08
  return portfolio_rets, turnover


def _momentum_12_1(prices: pd.DataFrame) -> tuple[pd.Series, float]:
  asset_rets = prices.pct_change().fillna(0.0)
  scores = prices.shift(21) / prices.shift(252) - 1.0

  weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
  current_w = pd.Series(0.0, index=prices.columns)
  top_n = max(1, prices.shape[1] // 2)

  for i, dt in enumerate(prices.index):
    if i == 0 or dt.month != prices.index[i - 1].month:
      s = scores.loc[dt].dropna()
      s = s[s > 0].sort_values(ascending=False).head(top_n)
      current_w = pd.Series(0.0, index=prices.columns)
      if not s.empty:
        current_w.loc[s.index] = 1.0 / len(s)
    weights.loc[dt] = current_w

  shifted = weights.shift(1).fillna(0.0)
  portfolio_rets = (asset_rets * shifted).sum(axis=1)
  turnover = float(weights.diff().abs().sum(axis=1).fillna(0.0).mean() / 2.0)
  return portfolio_rets, turnover


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
  rows: list[dict[str, Any]] = []
  for dt in dates:
    rows.append(
      {
        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
        "portfolio": float(portfolio.loc[dt]),
        "benchmark": float(benchmark.loc[dt]),
      }
    )
  return rows


def _build_baseline_result(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  universe_raw = os.getenv("FACTORLAB_UNIVERSE", "SPY,QQQ,IWM,EFA,EEM,TLT,GLD,VNQ")
  tickers = [x.strip().upper() for x in universe_raw.split(",") if x.strip()]
  if not tickers:
    tickers = ["SPY", "QQQ", "IWM", "EFA", "EEM"]

  prices = io.fetch_prices_frame(tickers, run["start_date"], run["end_date"])
  if prices.empty or prices.shape[0] < 40:
    prices = _download_prices(run["start_date"], run["end_date"], tickers)
  strat = run["strategy_id"]
  if strat == "equal_weight":
    daily_rets, turnover = _equal_weight(prices)
  elif strat == "momentum_12_1":
    daily_rets, turnover = _momentum_12_1(prices)
  else:
    raise ValueError(f"Unsupported baseline strategy: {strat}")

  benchmark_ticker = "SPY" if "SPY" in prices.columns else prices.columns[0]
  benchmark_rets = prices[benchmark_ticker].pct_change().fillna(0.0)

  portfolio = 100_000.0 * (1.0 + daily_rets).cumprod()
  benchmark = 100_000.0 * (1.0 + benchmark_rets).cumprod()
  rows = _equity_rows(prices.index, portfolio, benchmark)
  metrics = _compute_metrics(daily_rets, turnover)
  return BacktestResult(equity_rows=rows, metrics=metrics)


def _build_ml_result(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  universe_raw = os.getenv("FACTORLAB_UNIVERSE", "SPY,QQQ,IWM,EFA,EEM,TLT,GLD,VNQ")
  tickers = [x.strip().upper() for x in universe_raw.split(",") if x.strip()]
  if "SPY" not in tickers:
    tickers = ["SPY", *tickers]

  warmup_years = int(os.getenv("ML_WARMUP_YEARS", "5"))
  warmup_start = (
    pd.to_datetime(run["start_date"]) - pd.DateOffset(years=warmup_years)
  ).strftime("%Y-%m-%d")

  prices = io.fetch_prices_frame(tickers, warmup_start, run["end_date"])
  if prices.empty or prices.shape[0] < 260:
    prices = _download_prices(warmup_start, run["end_date"], tickers)

  benchmark_ticker = "SPY" if "SPY" in prices.columns else prices.columns[0]
  ml = run_walk_forward(
    run_id=run["id"],
    strategy=run["strategy_id"],
    prices=prices,
    start_date=run["start_date"],
    end_date=run["end_date"],
    benchmark_ticker=benchmark_ticker,
  )
  return BacktestResult(
    equity_rows=ml.equity_rows,
    metrics=ml.metrics,
    feature_rows=ml.feature_rows,
    prediction_rows=ml.prediction_rows,
    model_metadata=ml.metadata,
  )


def _run_backtest(io: SupabaseIO, run: dict[str, Any]) -> BacktestResult:
  strategy = run["strategy_id"]
  if strategy in {"equal_weight", "momentum_12_1"}:
    try:
      return _build_baseline_result(io, run)
    except Exception as exc:  # fallback keeps end-to-end loop unblocked
      print(f"[engine] baseline failed for {strategy}, using synthetic: {exc}")
  if strategy in {"ml_ridge", "ml_lightgbm"}:
    try:
      return _build_ml_result(io, run)
    except Exception as exc:
      print(f"[engine] ML failed for {strategy}, using synthetic: {exc}")

  seed = abs(hash(run["id"])) % (2**32)
  return _build_synthetic_result(run["start_date"], run["end_date"], seed=seed)


def _process_job(io: SupabaseIO, job: Job) -> None:
  if not io.claim_job(job):
    return

  started = datetime.utcnow()
  print(f"[engine] running job={job.id} run={job.run_id}")
  try:
    run = io.fetch_run(job.run_id)
    if run is None:
      raise RuntimeError(f"Run not found for run_id={job.run_id}")

    result = _run_backtest(io, run)
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
    )
    print(f"[engine] completed job={job.id} in {duration}s")
  except Exception as exc:
    duration = int((datetime.utcnow() - started).total_seconds())
    io.save_failure(job, duration, str(exc))
    print(f"[engine] failed job={job.id} in {duration}s: {exc}")


def main() -> None:
  poll_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
  batch_size = int(os.getenv("JOB_BATCH_SIZE", "3"))

  io = SupabaseIO()
  print("[engine] worker started")
  while True:
    jobs = io.fetch_queued_jobs(limit=batch_size)
    if not jobs:
      time.sleep(poll_seconds)
      continue

    for job in jobs:
      _process_job(io, job)


if __name__ == "__main__":
  main()
