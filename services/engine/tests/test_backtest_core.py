from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd

from factorlab_engine.turnover import annualize_turnover
from factorlab_engine.worker import (
    _annualize_turnover_from_rebalances,
    _apply_rebalance_costs,
    _compute_metrics,
    _equal_weight,
    _momentum_12_1,
    _rebalance_turnover_points,
    _slice_series_to_run_window,
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


def test_equal_weight_positions_sum_to_one():
    """Weights at every rebalance date must sum exactly to 1.0."""
    prices = _prices()
    _, _, _, positions = _equal_weight(prices)

    totals: dict[str, float] = defaultdict(float)
    for pos in positions:
        totals[pos["date"]] += pos["weight"]

    assert len(totals) > 0, "No positions produced"
    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-9, f"Weights sum to {total:.9f} on {dt}"


def test_momentum_12_1_respects_top_n():
    """With top_n=1, every post-warmup rebalance that has positive scores picks exactly 1 asset."""
    # 550 bdays ≈ 2.2 years from 2023-01-02 → prices end around Mar 2025.
    # Warmup is 252 bdays (12 months). Post-warmup starts around Jan 2024.
    prices = _prices(periods=550)
    _, _, _, positions = _momentum_12_1(prices, top_n=1)

    # Group positions by date
    per_date: dict[str, list[dict]] = defaultdict(list)
    for pos in positions:
        per_date[pos["date"]].append(pos)

    # Only check rebalance dates well after the 12-month warmup
    late = {dt: rows for dt, rows in per_date.items() if dt >= "2024-06-01"}
    assert len(late) > 0, "No post-warmup positions found"

    for dt, rows in late.items():
        # At most 1 asset selected (0 possible when no asset has a positive score)
        assert len(rows) <= 1, f"Expected ≤1 asset on {dt}, got {[r['symbol'] for r in rows]}"
        if rows:
            assert abs(rows[0]["weight"] - 1.0) < 1e-9, f"Single-asset weight should be 1.0 on {dt}"


def test_momentum_12_1_default_top_half_backward_compat():
    """Calling _momentum_12_1 without top_n should use top-half (legacy behaviour)."""
    prices = _prices(periods=550)
    _, _, _, positions_default = _momentum_12_1(prices)
    _, _, _, positions_half = _momentum_12_1(prices, top_n=len(prices.columns) // 2)

    # Both calls should produce identical position snapshots
    assert len(positions_default) == len(positions_half)
    for a, b in zip(positions_default, positions_half):
        assert a["date"] == b["date"]
        assert a["symbol"] == b["symbol"]
        assert abs(a["weight"] - b["weight"]) < 1e-12


def test_equal_weight_has_nonzero_turnover_after_init():
    """Equal weight on a stable universe must show > 0 annualized turnover.

    With the drift-reset fix, each monthly rebalance computes turnover against the
    actual drifted (non-equal) weights, so even with an unchanged universe the
    annualized turnover is strictly positive.
    """
    # 520 trading days ≈ 2 years — enough for >12 rebalances after init
    prices = _prices(periods=520)
    _, annual_turnover, rebalance_turnover, _ = _equal_weight(prices)

    # The annualized KPI should be positive after drift-reset fix
    assert annual_turnover > 0.0, (
        f"Expected equal_weight turnover > 0 after drift-reset fix, got {annual_turnover}"
    )

    # Every per-rebalance value should be non-negative
    assert (rebalance_turnover >= 0).all()

    # After the initial rebalance the subsequent rebalances should have non-zero turnover
    non_init = rebalance_turnover[rebalance_turnover > 0]
    assert len(non_init) >= 5, (
        f"Expected at least 5 non-zero rebalance turnover values after init, got {len(non_init)}"
    )


def test_equal_weight_turnover_excludes_warmup():
    """KPI turnover must be recomputed from the sliced run-window series, not the full warmup window.

    The production path in _build_baseline_result:
      1. Calls _equal_weight on the full warmup+run price history.
      2. Slices rebalance_turnover to the run window.
      3. Recomputes `turnover` from the sliced series with exclude_initial=False.

    This test replicates that logic and verifies the run-window-only KPI differs from
    the full-window KPI when warmup rebalances are present.
    """
    # 320 bdays: treat the first 60 as warmup, the rest as the run window.
    prices = _prices(periods=320)
    run_prices = prices.iloc[60:]

    _, ann_full, rebal_full, _ = _equal_weight(prices)

    run_start = str(run_prices.index[0].date())
    run_end = str(run_prices.index[-1].date())
    sliced = _slice_series_to_run_window(rebal_full, run_start, run_end)
    pts = _rebalance_turnover_points(sliced, periods_per_year=12.0)
    kpi_fixed = annualize_turnover(pts, periods_per_year=12.0, exclude_initial=False)

    # Fixed KPI must be positive
    assert kpi_fixed > 0.0, f"Run-window-only KPI should be > 0, got {kpi_fixed}"

    # Fixed KPI must differ from the full-window KPI (warmup rebalances dilute the average)
    assert abs(kpi_fixed - ann_full) > 1e-6, (
        f"Run-window KPI ({kpi_fixed:.6f}) should differ from full-window KPI ({ann_full:.6f})"
    )

    # Convenience: _annualize_turnover_from_rebalances with exclude_initial=False should match
    kpi_via_helper = _annualize_turnover_from_rebalances(
        sliced, periods_per_year=12.0, exclude_initial=False
    )
    assert abs(kpi_fixed - kpi_via_helper) < 1e-12
