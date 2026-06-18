from __future__ import annotations

import numpy as np
import pandas as pd

from .ml_types import FEATURE_COLUMNS


def compute_daily_features(prices: pd.DataFrame, benchmark_ticker: str) -> pd.DataFrame:
    """Build a long-format feature DataFrame: one row per (date, non-benchmark symbol).

    All features use only price data up to date t - no lookahead.
    Target y = next-day return: close(t+1) / close(t) - 1  (shift(-1) of daily_ret).

    The dataset is kept in LONG format.  Symbols missing features on a given date
    simply produce NaN on that row; they are dropped per-row later, NOT by requiring
    every symbol to have data on the same date (which would inner-join away rows).
    """
    prices = prices.sort_index().ffill().dropna(how="all")
    daily_ret = prices.pct_change()

    # Momentum features (vectorized over all columns)
    mom_5d = prices / prices.shift(5) - 1.0
    mom_20d = prices / prices.shift(20) - 1.0
    mom_60d = prices / prices.shift(60) - 1.0
    mom_252d = prices / prices.shift(252) - 1.0

    # Volatility
    vol_20d = daily_ret.rolling(20).std(ddof=0)
    vol_60d = daily_ret.rolling(60).std(ddof=0)

    # Max-drawdown over trailing 252 trading days
    drawdown_252d = prices / prices.rolling(252).max() - 1.0

    # Rolling beta vs benchmark (vectorized - no per-ticker Python loop)
    bench_ret = daily_ret[benchmark_ticker]
    bench_var = bench_ret.rolling(60).var()
    cov_matrix = daily_ret.rolling(60).cov(bench_ret)  # type: ignore[arg-type]
    beta_60d = cov_matrix.div(bench_var, axis=0).replace([np.inf, -np.inf], np.nan)

    # Target: next-day return
    target_return = daily_ret.shift(-1)
    benchmark_return = target_return[benchmark_ticker]

    # Stack wide DataFrames to long format
    portfolio_tickers = [t for t in prices.columns if t != benchmark_ticker]
    if not portfolio_tickers:
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    for ticker in portfolio_tickers:
        df = pd.DataFrame(
            {
                "date": prices.index,
                "ticker": ticker,
                "mom_5d": mom_5d[ticker].to_numpy(),
                "mom_20d": mom_20d[ticker].to_numpy(),
                "mom_60d": mom_60d[ticker].to_numpy(),
                "mom_252d": mom_252d[ticker].to_numpy(),
                "vol_20d": vol_20d[ticker].to_numpy(),
                "vol_60d": vol_60d[ticker].to_numpy(),
                "drawdown_252d": drawdown_252d[ticker].to_numpy(),
                "beta_60d": beta_60d[ticker].to_numpy(),
                "target_return": target_return[ticker].to_numpy(),
                "benchmark_return": benchmark_return.to_numpy(),
            }
        )
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


def _feature_matrix(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep feature names attached across fit/predict for sklearn-compatible models."""
    return frame.loc[:, FEATURE_COLUMNS]


def _sort_ml_rows(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.sort_values(["date", "ticker"], kind="stable").reset_index(drop=True)
