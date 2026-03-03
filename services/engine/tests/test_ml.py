from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.ml import FEATURE_COLUMNS, compute_monthly_features, run_walk_forward


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_prices(n_months: int = 60, n_assets: int = 5, seed: int = 42) -> pd.DataFrame:
  """Synthetic daily prices with one benchmark column (SPY)."""
  rng = np.random.default_rng(seed)
  tickers = [f"T{i}" for i in range(n_assets)] + ["SPY"]
  dates = pd.bdate_range("2015-01-01", periods=n_months * 21)
  prices: dict[str, np.ndarray] = {}
  for ticker in tickers:
    daily_ret = rng.normal(0.0003, 0.01, len(dates))
    prices[ticker] = 100.0 * (1.0 + daily_ret).cumprod()
  return pd.DataFrame(prices, index=dates)


# ── compute_monthly_features ──────────────────────────────────────────────────

def test_feature_frame_has_expected_columns():
  prices = _make_prices(n_months=36, n_assets=3)
  frame = compute_monthly_features(prices, benchmark_ticker="SPY")

  required = {
    "date",
    "ticker",
    "target_return",
    "benchmark_return",
    "momentum_12_1",
    "momentum_6_1",
    "reversal_1m",
    "vol_20d",
    "vol_60d",
    "beta_60d",
    "drawdown_6m",
  }
  assert required.issubset(set(frame.columns))
  assert set(FEATURE_COLUMNS).issubset(set(frame.columns))


def test_target_is_next_month_return_alignment():
  prices = _make_prices(n_months=48, n_assets=2)
  frame = compute_monthly_features(prices, benchmark_ticker="SPY")

  monthly_px = prices.resample("ME").last().ffill()
  monthly_ret = monthly_px.pct_change().shift(-1)

  ticker = "T0"
  sample = frame[frame["ticker"] == ticker].dropna(subset=["target_return"]).iloc[10]
  dt = pd.Timestamp(sample["date"])
  expected = float(monthly_ret.at[dt, ticker])
  assert np.isclose(float(sample["target_return"]), expected, atol=1e-12)


def test_features_do_not_use_future_data():
  prices = _make_prices(n_months=48, n_assets=2)
  base = compute_monthly_features(prices, benchmark_ticker="SPY")

  cutoff = prices.index[len(prices) // 2]
  mutated = prices.copy()
  mutated.loc[mutated.index > cutoff, "T0"] *= 4.0

  changed = compute_monthly_features(mutated, benchmark_ticker="SPY")

  key_date = (cutoff.to_period("M") - 1).to_timestamp("M")
  key_date_str = key_date.strftime("%Y-%m-%d")

  base_row = base[(base["ticker"] == "T0") & (base["date"] == key_date_str)]
  changed_row = changed[(changed["ticker"] == "T0") & (changed["date"] == key_date_str)]

  for col in FEATURE_COLUMNS:
    assert np.isclose(float(base_row.iloc[0][col]), float(changed_row.iloc[0][col]), equal_nan=True)


# ── run_walk_forward ──────────────────────────────────────────────────────────

def test_walk_forward_split_and_output_shapes(monkeypatch: pytest.MonkeyPatch):
  monkeypatch.setenv("ML_MIN_TRAIN_MONTHS", "24")

  prices = _make_prices(n_months=72, n_assets=6)
  result = run_walk_forward(
    run_id="test-shapes",
    strategy="ml_ridge",
    prices=prices,
    start_date="2015-01-01",
    end_date="2020-12-31",
    benchmark_ticker="SPY",
    top_n=3,
    cost_bps=10.0,
  )

  assert len(result.equity_rows) > 0
  assert len(result.prediction_rows) > 0
  assert len(result.position_rows) > 0

  as_of_dates = sorted({r["as_of_date"] for r in result.prediction_rows})
  assert as_of_dates[0] >= "2017-01-31"  # respects 24-month expanding warmup

  for as_of in as_of_dates:
    picks = [r for r in result.prediction_rows if r["as_of_date"] == as_of and r["selected"]]
    if not picks:
      continue
    assert len(picks) == 3
    assert abs(sum(float(r["weight"]) for r in picks) - 1.0) < 1e-8


def test_positions_match_selected_predictions():
  prices = _make_prices(n_months=60, n_assets=4)
  result = run_walk_forward(
    run_id="test-positions",
    strategy="ml_ridge",
    prices=prices,
    start_date="2018-01-01",
    end_date="2019-12-31",
    benchmark_ticker="SPY",
    top_n=2,
    cost_bps=5.0,
  )

  selected = [r for r in result.prediction_rows if r["selected"]]
  positions = {(r["date"], r["symbol"]): float(r["weight"]) for r in result.position_rows}
  for row in selected:
    key = (row["as_of_date"], row["ticker"])
    assert key in positions
    assert np.isclose(positions[key], float(row["weight"]), atol=1e-12)


def test_metrics_sanity():
  prices = _make_prices(n_months=60, n_assets=4)
  result = run_walk_forward(
    run_id="test-metrics",
    strategy="ml_lightgbm",
    prices=prices,
    start_date="2018-01-01",
    end_date="2019-12-31",
    benchmark_ticker="SPY",
    top_n=3,
    cost_bps=10.0,
  )

  m = result.metrics
  assert -1.0 <= m["max_drawdown"] <= 0.0
  assert np.isfinite(m["cagr"])
  assert np.isfinite(m["sharpe"])
  assert m["turnover"] >= 0.0


def test_walk_forward_raises_with_insufficient_window():
  prices = _make_prices(n_months=12, n_assets=3)
  with pytest.raises(RuntimeError):
    run_walk_forward(
      run_id="test-err",
      strategy="ml_ridge",
      prices=prices,
      start_date="2015-01-01",
      end_date="2015-06-30",
      benchmark_ticker="SPY",
      top_n=2,
      cost_bps=10.0,
    )
