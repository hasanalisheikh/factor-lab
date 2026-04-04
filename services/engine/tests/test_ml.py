from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.ml import (
    FEATURE_COLUMNS,
    LIGHTGBM_DETERMINISM_MODE,
    _build_model,
    compute_daily_features,
    run_walk_forward,
)


def _lgbm_available() -> bool:
    """Return True if LightGBM and its native library can be loaded."""
    try:
        import lightgbm  # noqa: F401

        return True
    except (ImportError, OSError):
        return False


_requires_lgbm = pytest.mark.skipif(
    not _lgbm_available(),
    reason="LightGBM native library not available (install libomp via `brew install libomp`)",
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_prices(n_months: int = 72, n_assets: int = 10, seed: int = 42) -> pd.DataFrame:
    """Synthetic daily prices: n_assets tickers + SPY benchmark.

    Using 72 months (6 years) and 10 assets by default so that all daily
    ML validation thresholds (252 train days, avg_symbols >= top_n) are met.
    """
    rng = np.random.default_rng(seed)
    tickers = [f"T{i}" for i in range(n_assets)] + ["SPY"]
    # Use 21 trading days per month as approximation
    dates = pd.bdate_range("2015-01-01", periods=n_months * 21)
    prices: dict[str, np.ndarray] = {}
    for ticker in tickers:
        daily_ret = rng.normal(0.0003, 0.01, len(dates))
        prices[ticker] = 100.0 * (1.0 + daily_ret).cumprod()
    return pd.DataFrame(prices, index=dates)


# ── compute_daily_features ────────────────────────────────────────────────────


def test_feature_frame_has_expected_columns():
    prices = _make_prices(n_months=36, n_assets=3)
    frame = compute_daily_features(prices, benchmark_ticker="SPY")

    required = {
        "date",
        "ticker",
        "target_return",
        "benchmark_return",
    } | set(FEATURE_COLUMNS)
    assert required.issubset(set(frame.columns))
    assert set(FEATURE_COLUMNS) == {
        "mom_5d",
        "mom_20d",
        "mom_60d",
        "mom_252d",
        "vol_20d",
        "vol_60d",
        "drawdown_252d",
        "beta_60d",
    }


def test_dataset_builder_long_format():
    """Output must be long format (one row per date×symbol) with no lookahead."""
    prices = _make_prices(n_months=36, n_assets=4)
    frame = compute_daily_features(prices, benchmark_ticker="SPY")

    # Long format: multiple rows per date (one per non-benchmark symbol)
    date_counts = frame.groupby("date").size()
    # Each trading date should have ~4 rows (T0..T3), not 1 wide row
    assert date_counts.max() == 4, f"Expected 4 symbols/date, got max={date_counts.max()}"
    assert "SPY" not in frame["ticker"].values, "Benchmark should not appear as a portfolio ticker"

    # No lookahead: features at date t must not change if we mutate future prices
    cutoff = prices.index[len(prices) // 2]
    mutated = prices.copy()
    mutated.loc[mutated.index > cutoff, "T0"] *= 4.0  # inflate future prices

    changed = compute_daily_features(mutated, benchmark_ticker="SPY")

    # Pick a date well before the cutoff
    safe_date = prices.index[len(prices) // 2 - 10]
    safe_str = safe_date.strftime("%Y-%m-%d")

    base_row = frame[(frame["ticker"] == "T0") & (frame["date"] == safe_date)]
    change_row = changed[(changed["ticker"] == "T0") & (changed["date"] == safe_date)]

    assert not base_row.empty, f"No row for T0 at {safe_str} in base frame"
    assert not change_row.empty, f"No row for T0 at {safe_str} in changed frame"

    for col in FEATURE_COLUMNS:
        b = float(base_row.iloc[0][col])
        c = float(change_row.iloc[0][col])
        assert np.isclose(b, c, equal_nan=True), (
            f"Feature '{col}' differs at {safe_str} after mutating future prices: base={b} changed={c}"
        )


def test_target_is_next_day_return_alignment():
    """target_return at date t must equal close(t+1)/close(t) - 1."""
    prices = _make_prices(n_months=36, n_assets=2)
    frame = compute_daily_features(prices, benchmark_ticker="SPY")

    daily_ret = prices.pct_change()
    # next-day return = shift(-1) of daily_ret
    next_day = daily_ret.shift(-1)

    ticker = "T0"
    # Pick a row that has a valid target_return
    sample_rows = frame[(frame["ticker"] == ticker)].dropna(subset=["target_return"])
    assert not sample_rows.empty

    sample = sample_rows.iloc[5]
    dt = pd.Timestamp(sample["date"])
    expected = float(next_day.at[dt, ticker])
    assert np.isclose(float(sample["target_return"]), expected, atol=1e-12)


# ── run_walk_forward ──────────────────────────────────────────────────────────


def test_walk_forward_split_and_output_shapes(monkeypatch: pytest.MonkeyPatch):
    """End-to-end daily walk-forward: verify output shapes and structure."""
    monkeypatch.setenv("ML_MIN_TRAIN_DAYS", "252")
    monkeypatch.setenv("ML_TRAIN_WINDOW_DAYS", "504")
    monkeypatch.setenv("ML_REFIT_FREQ_DAYS", "5")

    # Use a little over 6 years so the synthetic series still covers the asserted end date.
    prices = _make_prices(n_months=84, n_assets=6)
    result = run_walk_forward(
        run_id="test-shapes",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2020-12-31",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )

    # Equity curve should span roughly the backtest window in trading days
    assert len(result.equity_rows) > 0, "No equity rows produced"
    assert result.equity_rows[0]["date"] == "2018-01-01"
    assert result.equity_rows[-1]["date"] == "2020-12-31"
    # ~3 years × 252 days = ~756 days — warmup eats first ~252, so at least 400
    assert len(result.equity_rows) >= 400, f"Too few equity rows: {len(result.equity_rows)}"

    # Predictions only stored for last 20 dates
    assert len(result.prediction_rows) > 0
    as_of_dates = sorted({r["as_of_date"] for r in result.prediction_rows})
    assert len(as_of_dates) <= 20, f"Expected ≤20 as_of_dates, got {len(as_of_dates)}"

    # Positions non-empty
    assert len(result.position_rows) > 0

    # Model impl stored correctly
    assert result.metadata.get("model_params", {}).get("model_impl") == "ridge"

    # Each selected date has exactly top_n picks with weights summing to 1
    for as_of in as_of_dates:
        picks = [r for r in result.prediction_rows if r["as_of_date"] == as_of and r["selected"]]
        if not picks:
            continue
        assert len(picks) == 3, f"Expected 3 picks at {as_of}, got {len(picks)}"
        assert abs(sum(float(r["weight"]) for r in picks) - 1.0) < 1e-8


def test_walk_forward_validates_recent_training_window_not_full_warmup_history():
    prices = _make_prices(n_months=84, n_assets=5)
    late_start = pd.Timestamp("2017-01-03")
    prices.loc[prices.index < late_start, "T4"] = np.nan

    result = run_walk_forward(
        run_id="test-recent-window-validation",
        strategy="ml_ridge",
        prices=prices,
        start_date="2020-01-02",
        end_date="2020-12-31",
        benchmark_ticker="SPY",
        top_n=5,
        cost_bps=10.0,
    )

    assert len(result.equity_rows) > 0
    model_params = result.metadata.get("model_params", {})
    assert model_params.get("top_n") == 5
    assert model_params.get("train_days", 0) >= 252
    assert model_params.get("avg_symbols_per_day", 0) >= 5.0


def test_positions_match_selected_predictions():
    """Position weights must align with selected prediction weights."""
    prices = _make_prices(n_months=72, n_assets=6)
    result = run_walk_forward(
        run_id="test-positions",
        strategy="ml_ridge",
        prices=prices,
        start_date="2019-01-01",
        end_date="2020-06-30",
        benchmark_ticker="SPY",
        top_n=2,
        cost_bps=5.0,
    )

    # Build position lookup: (date, symbol) -> weight
    positions = {(r["date"], r["symbol"]): float(r["weight"]) for r in result.position_rows}
    selected = [r for r in result.prediction_rows if r["selected"]]

    for row in selected:
        key = (row["target_date"], row["ticker"])
        assert key in positions, f"Position missing for {key}"
        assert np.isclose(positions[key], float(row["weight"]), atol=1e-12)


def test_walk_forward_invokes_progress_callback():
    prices = _make_prices(n_months=72, n_assets=6)
    progress_calls: list[tuple[int, int]] = []

    run_walk_forward(
        run_id="test-progress-callback",
        strategy="ml_ridge",
        prices=prices,
        start_date="2019-01-01",
        end_date="2020-06-30",
        benchmark_ticker="SPY",
        top_n=2,
        cost_bps=5.0,
        progress_cb=lambda processed, total: progress_calls.append((processed, total)),
    )

    assert progress_calls, "Expected in-loop ML progress callbacks"
    assert progress_calls[-1][0] == progress_calls[-1][1]


@_requires_lgbm
def test_lightgbm_model_uses_strict_deterministic_params():
    model = _build_model("ml_lightgbm")
    params = model.get_params()

    assert params["subsample"] == 1.0
    assert params["subsample_freq"] == 0
    assert params["colsample_bytree"] == 1.0
    assert params["n_jobs"] == 1
    assert params["random_state"] == 0
    assert params["deterministic"] is True
    assert params["force_row_wise"] is True
    assert params["data_random_seed"] == 0
    assert params["feature_fraction_seed"] == 0
    assert params["bagging_seed"] == 0
    assert params["extra_seed"] == 0
    assert params["drop_seed"] == 0
    assert params["objective_seed"] == 0


@_requires_lgbm
def test_lightgbm_repeatability_same_deployment():
    prices = _make_prices(n_months=72, n_assets=6, seed=7)
    run_id = "test-repeatability"

    result_a = run_walk_forward(
        run_id=run_id,
        strategy="ml_lightgbm",
        prices=prices,
        start_date="2019-01-01",
        end_date="2020-06-30",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )
    result_b = run_walk_forward(
        run_id=run_id,
        strategy="ml_lightgbm",
        prices=prices,
        start_date="2019-01-01",
        end_date="2020-06-30",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )

    assert result_a.prediction_rows == result_b.prediction_rows
    assert result_a.position_rows == result_b.position_rows
    assert result_a.equity_rows == result_b.equity_rows
    assert result_a.metrics == result_b.metrics

    model_params_a = result_a.metadata.get("model_params", {})
    model_params_b = result_b.metadata.get("model_params", {})
    assert model_params_a == model_params_b
    assert model_params_a.get("model_impl") == "lightgbm"
    assert model_params_a.get("determinism_mode") == LIGHTGBM_DETERMINISM_MODE
    assert model_params_a.get("lightgbm_version")
    assert isinstance(model_params_a.get("deterministic_model_params"), dict)


@_requires_lgbm
def test_metrics_sanity():
    prices = _make_prices(n_months=72, n_assets=6)
    result = run_walk_forward(
        run_id="test-metrics",
        strategy="ml_lightgbm",
        prices=prices,
        start_date="2019-01-01",
        end_date="2020-06-30",
        benchmark_ticker="SPY",
        top_n=3,
        cost_bps=10.0,
    )

    m = result.metrics
    assert result.metadata.get("model_params", {}).get("model_impl") == "lightgbm"
    assert -1.0 <= m["max_drawdown"] <= 0.0
    assert np.isfinite(m["cagr"])
    assert np.isfinite(m["sharpe"])
    assert m["turnover"] >= 0.0
    assert 0.0 <= m["win_rate"] <= 1.0


def test_walk_forward_raises_with_insufficient_data():
    """Short price history → RuntimeError with diagnostic train_rows/train_days info."""
    # 18 months is not enough to satisfy ML_MIN_TRAIN_DAYS=252 before the window
    prices = _make_prices(n_months=18, n_assets=3)
    with pytest.raises(RuntimeError, match="Insufficient ML training data"):
        run_walk_forward(
            run_id="test-err",
            strategy="ml_ridge",
            prices=prices,
            start_date="2015-01-01",
            end_date="2015-12-31",
            benchmark_ticker="SPY",
            top_n=2,
            cost_bps=10.0,
        )


def test_ml_lightgbm_fails_loudly_without_lightgbm(monkeypatch: pytest.MonkeyPatch):
    """ml_lightgbm must raise RuntimeError (not silently fall back to Ridge)
    when the lightgbm package is unavailable."""
    import builtins

    real_import = builtins.__import__

    def _block_lightgbm(name: str, *args, **kwargs):
        if name == "lightgbm":
            raise ImportError("lightgbm intentionally blocked by test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _block_lightgbm)

    prices = _make_prices(n_months=72, n_assets=6)
    with pytest.raises(RuntimeError, match="ml_lightgbm requires LightGBM"):
        run_walk_forward(
            run_id="test-no-lgbm",
            strategy="ml_lightgbm",
            prices=prices,
            start_date="2019-01-01",
            end_date="2020-06-30",
            benchmark_ticker="SPY",
            top_n=2,
            cost_bps=10.0,
        )
