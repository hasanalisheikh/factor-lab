from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.ml import FEATURE_COLUMNS, compute_monthly_features, run_walk_forward


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_prices(n_months: int = 60, n_assets: int = 5, seed: int = 42) -> pd.DataFrame:
    """Synthetic daily price DataFrame with an SPY benchmark column."""
    rng = np.random.default_rng(seed)
    tickers = [f"T{i}" for i in range(n_assets)] + ["SPY"]
    dates = pd.bdate_range("2015-01-01", periods=n_months * 21)
    prices: dict[str, np.ndarray] = {}
    for t in tickers:
        daily_ret = rng.normal(0.0003, 0.01, len(dates))
        prices[t] = 100.0 * (1.0 + daily_ret).cumprod()
    return pd.DataFrame(prices, index=dates)


# ── compute_monthly_features ──────────────────────────────────────────────────

def test_feature_frame_has_expected_columns():
    prices = _make_prices(n_months=36, n_assets=3)
    frame = compute_monthly_features(prices, benchmark_ticker="SPY")

    required = {"date", "ticker", "target_return", "benchmark_return"} | set(FEATURE_COLUMNS)
    assert required.issubset(set(frame.columns))


def test_feature_frame_covers_all_tickers():
    n_assets = 4
    prices = _make_prices(n_months=36, n_assets=n_assets)
    frame = compute_monthly_features(prices, benchmark_ticker="SPY")

    expected_tickers = {f"T{i}" for i in range(n_assets)} | {"SPY"}
    assert expected_tickers == set(frame["ticker"].unique())


def test_momentum_is_bounded():
    """12-month momentum should not be extreme for realistic prices."""
    prices = _make_prices(n_months=48, n_assets=3)
    frame = compute_monthly_features(prices, benchmark_ticker="SPY")
    mom = frame["momentum"].dropna()
    assert (mom.abs() < 10.0).all(), "Momentum has unrealistic outliers"


def test_volatility_is_non_negative():
    prices = _make_prices(n_months=48, n_assets=3)
    frame = compute_monthly_features(prices, benchmark_ticker="SPY")
    vol = frame["volatility"].dropna()
    assert (vol >= 0).all()


def test_drawdown_is_non_positive():
    prices = _make_prices(n_months=48, n_assets=3)
    frame = compute_monthly_features(prices, benchmark_ticker="SPY")
    dd = frame["drawdown"].dropna()
    assert (dd <= 0.001).all(), "Drawdown should be <= 0"


# ── run_walk_forward ──────────────────────────────────────────────────────────

def test_walk_forward_ridge_returns_valid_artifacts():
    prices = _make_prices(n_months=60, n_assets=6)
    result = run_walk_forward(
        run_id="test-ridge",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-12-31",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )

    assert len(result.equity_rows) > 0
    assert len(result.prediction_rows) > 0
    assert len(result.feature_rows) > 0

    m = result.metrics
    assert -1.0 <= m["max_drawdown"] <= 0.0
    assert 0.0 <= m["win_rate"] <= 1.0
    assert m["volatility"] >= 0.0


def test_walk_forward_metadata_fields():
    prices = _make_prices(n_months=60, n_assets=4)
    result = run_walk_forward(
        run_id="test-meta",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-12-31",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=5.0,
    )

    meta = result.metadata
    assert meta["model_name"] == "ml_ridge"
    assert meta["top_n"] == 3
    assert meta["cost_bps"] == 5.0
    assert set(meta["feature_importance"].keys()) == set(FEATURE_COLUMNS)
    assert meta["rebalance_count"] == len(result.equity_rows)


def test_walk_forward_feature_importance_sums_to_one():
    prices = _make_prices(n_months=60, n_assets=4)
    result = run_walk_forward(
        run_id="test-fi",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-06-30",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )
    total = sum(result.metadata["feature_importance"].values())
    assert abs(total - 1.0) < 1e-6


def test_walk_forward_top_n_capped_by_universe():
    """top_n larger than universe should be capped silently."""
    prices = _make_prices(n_months=60, n_assets=2)  # 2 non-benchmark tickers
    result = run_walk_forward(
        run_id="test-cap",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-12-31",
        benchmark_ticker="SPY",
        top_n=999,
        cost_bps=0.0,
    )
    # All selected rows should have equal weight summing to ~1
    for date in {r["as_of_date"] for r in result.prediction_rows}:
        selected = [r for r in result.prediction_rows if r["as_of_date"] == date and r["selected"]]
        if selected:
            total_w = sum(r["weight"] for r in selected)
            assert abs(total_w - 1.0) < 1e-6


def test_walk_forward_raises_with_insufficient_window():
    """Backtest window inside warmup period should raise RuntimeError."""
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
