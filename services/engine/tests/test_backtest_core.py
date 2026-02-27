from __future__ import annotations

import numpy as np
import pandas as pd

from factorlab_engine.worker import (
  _apply_rebalance_costs,
  _compute_metrics,
  _equal_weight,
  _momentum_12_1,
)


def _prices(periods: int = 320) -> pd.DataFrame:
  dates = pd.bdate_range("2023-01-02", periods=periods)
  trend = np.linspace(100, 140, periods)
  return pd.DataFrame(
    {
      "AAA": trend * (1 + 0.03 * np.sin(np.arange(periods) / 8)),
      "BBB": trend * 0.96 * (1 + 0.02 * np.cos(np.arange(periods) / 7)),
      "CCC": trend * 1.02 * (1 + 0.025 * np.sin(np.arange(periods) / 9 + 0.4)),
    },
    index=dates,
  )


def test_equal_weight_matches_average_asset_return():
  prices = _prices()
  rets = prices.pct_change().fillna(0.0)
  ew_rets, _, _, _ = _equal_weight(prices)
  expected = rets.mean(axis=1)
  assert np.allclose(ew_rets.values, expected.values)


def test_momentum_turnover_is_bounded():
  prices = _prices()
  _, annual_turnover, rebalance_turnover, _ = _momentum_12_1(prices)
  assert 0.0 <= annual_turnover <= 12.0
  assert (rebalance_turnover >= 0).all()
  assert (rebalance_turnover <= 1).all()


def test_costs_reduce_returns_on_rebalance_dates():
  idx = pd.bdate_range("2024-01-02", periods=5)
  gross = pd.Series([0.01, 0.0, 0.01, 0.0, 0.0], index=idx)
  turnover = pd.Series([0.5, 0.0, 1.0, 0.0, 0.0], index=idx)
  net = _apply_rebalance_costs(gross, turnover, costs_bps=10)
  assert net.iloc[0] < gross.iloc[0]
  assert net.iloc[2] < gross.iloc[2]
  assert net.iloc[1] == gross.iloc[1]


def test_max_drawdown_is_valid_fraction():
  idx = pd.bdate_range("2024-01-02", periods=8)
  rets = pd.Series([0.02, -0.01, -0.03, 0.01, 0.0, -0.02, 0.015, 0.005], index=idx)
  metrics = _compute_metrics(rets, turnover=0.2)
  assert -1.0 <= metrics["max_drawdown"] <= 0.0
