"""Unit tests for _low_vol and _trend_filter strategies.

low_vol:
  - Selects the lowest-vol asset(s) on toy data
  - Weights sum to 1.0 at every rebalance date

trend_filter:
  - Allocates 100% TLT when benchmark is below 200D SMA (risk-off)
  - Holds non-defensive assets when benchmark is above 200D SMA (risk-on)
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.worker import _low_vol, _trend_filter, _TREND_SMA_WINDOW


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_known_vol_prices(n_days: int = 250) -> pd.DataFrame:
    """Three assets with very different volatilities: LOW < MED < HIGH.

    The 100x scale difference between LOW and HIGH ensures vol_60 always
    ranks them correctly regardless of the random seed.
    """
    rng = np.random.default_rng(42)
    dates = pd.bdate_range("2020-01-01", periods=n_days)
    return pd.DataFrame(
        {
            "LOW":  100.0 * (1 + rng.normal(0, 0.0003, n_days)).cumprod(),
            "MED":  100.0 * (1 + rng.normal(0, 0.01,   n_days)).cumprod(),
            "HIGH": 100.0 * (1 + rng.normal(0, 0.05,   n_days)).cumprod(),
        },
        index=dates,
    )


def _make_trend_prices(n_days: int = 650) -> tuple[pd.DataFrame, list[str], str, str]:
    """Prices with a clear two-regime benchmark:

    Days   0–349 : benchmark in a strong uptrend (100 → 250).
    Days 350–649 : benchmark in a sharp decline  (250 → 50).

    After ~200 days into the decline the SMA-200 is well above the current
    price, guaranteeing risk-off signal for the last rebalance dates.
    During the uptrend (days 200–300) the price is well above the SMA,
    guaranteeing risk-on signal.
    """
    dates = pd.bdate_range("2017-01-01", periods=n_days)
    bench = np.concatenate([
        np.linspace(100.0, 250.0, 350),
        np.linspace(250.0, 50.0,  n_days - 350),
    ])
    tlt = np.linspace(100.0, 130.0, n_days)   # steady upward → bond proxy
    rng = np.random.default_rng(42)
    t0  = 100.0 * (1 + rng.normal(0.0003, 0.01, n_days)).cumprod()
    t1  = 100.0 * (1 + rng.normal(0.0003, 0.01, n_days)).cumprod()
    prices = pd.DataFrame(
        {"T0": t0, "T1": t1, "SPY": bench, "TLT": tlt},
        index=dates,
    )
    return prices, ["T0", "T1"], "SPY", "TLT"


# ---------------------------------------------------------------------------
# _low_vol tests
# ---------------------------------------------------------------------------

def test_low_vol_selects_lowest_vol_asset():
    """After the 60-day warmup, every rebalance should pick only 'LOW'."""
    prices = _make_known_vol_prices()
    _, _, _, positions = _low_vol(prices, top_n=1)

    # Skip warmup period (first ~3 months); check all subsequent rebalances
    late = [p for p in positions if p["date"] >= "2020-04-01"]
    assert len(late) > 0, "No positions found after warmup"
    for pos in late:
        assert pos["symbol"] == "LOW", (
            f"Expected 'LOW' but got '{pos['symbol']}' on {pos['date']}"
        )


def test_low_vol_selects_two_lowest_vol_assets():
    """With top_n=2 the selected pair should always be LOW and MED."""
    prices = _make_known_vol_prices()
    _, _, _, positions = _low_vol(prices, top_n=2)

    late = [p for p in positions if p["date"] >= "2020-04-01"]
    assert len(late) > 0
    symbols_per_date: dict[str, set[str]] = defaultdict(set)
    for pos in late:
        symbols_per_date[pos["date"]].add(pos["symbol"])

    for dt, symbols in symbols_per_date.items():
        assert symbols == {"LOW", "MED"}, (
            f"Expected {{LOW, MED}} on {dt}, got {symbols}"
        )


def test_low_vol_weights_sum_to_one():
    """Weights must sum exactly to 1.0 at every rebalance date."""
    prices = _make_known_vol_prices()
    _, _, _, positions = _low_vol(prices, top_n=2)

    totals: dict[str, float] = defaultdict(float)
    for pos in positions:
        totals[pos["date"]] += pos["weight"]

    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-9, (
            f"Weights sum to {total:.6f} on {dt}, expected 1.0"
        )


def test_low_vol_top_n_clamped_to_universe():
    """top_n larger than universe should not error and should hold everything."""
    prices = _make_known_vol_prices()
    _, _, _, positions = _low_vol(prices, top_n=100)

    late = [p for p in positions if p["date"] >= "2020-04-01"]
    assert len(late) > 0

    totals: dict[str, float] = defaultdict(float)
    for pos in late:
        totals[pos["date"]] += pos["weight"]
    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-9


def test_low_vol_insufficient_history_raises():
    """Fewer than 60 daily rows must raise ValueError."""
    rng = np.random.default_rng(0)
    prices = pd.DataFrame(
        {"A": 100 * (1 + rng.normal(0, 0.01, 50)).cumprod()},
        index=pd.bdate_range("2020-01-01", periods=50),
    )
    with pytest.raises(ValueError, match="60 daily data points"):
        _low_vol(prices, top_n=1)


# ---------------------------------------------------------------------------
# _trend_filter tests
# ---------------------------------------------------------------------------

def test_trend_filter_risk_off_when_below_sma():
    """Late in the decline the benchmark is well below SMA-200: expect 100% TLT."""
    prices, universe, benchmark, defensive = _make_trend_prices()

    _, _, _, positions = _trend_filter(
        prices,
        universe_tickers=universe,
        benchmark_ticker=benchmark,
        defensive_ticker=defensive,
    )

    # Last 40 business days are deep in the decline — risk-off expected
    threshold = prices.index[-40].strftime("%Y-%m-%d")
    late = [p for p in positions if p["date"] >= threshold]
    assert len(late) > 0, "No positions in the late period"

    for pos in late:
        assert pos["symbol"] == "TLT", (
            f"Expected risk-off (TLT) on {pos['date']}, got '{pos['symbol']}'"
        )
        assert abs(pos["weight"] - 1.0) < 1e-9, (
            f"TLT weight should be 1.0 on {pos['date']}, got {pos['weight']}"
        )


def test_trend_filter_risk_on_when_above_sma():
    """Mid-uptrend (after SMA-200 warmup) the benchmark is above SMA: expect no TLT."""
    prices, universe, benchmark, defensive = _make_trend_prices()

    _, _, _, positions = _trend_filter(
        prices,
        universe_tickers=universe,
        benchmark_ticker=benchmark,
        defensive_ticker=defensive,
    )

    # Window safely inside the uptrend (days 220–300), after 200-day warmup
    early_start = prices.index[220].strftime("%Y-%m-%d")
    early_end   = prices.index[300].strftime("%Y-%m-%d")
    early = [p for p in positions if early_start <= p["date"] <= early_end]
    assert len(early) > 0, "No risk-on positions found in the early window"

    for pos in early:
        assert pos["symbol"] != "TLT", (
            f"Should be risk-on (not TLT) on {pos['date']}"
        )

    # Weights must sum to 1 per date
    totals: dict[str, float] = defaultdict(float)
    for pos in early:
        totals[pos["date"]] += pos["weight"]
    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-9, (
            f"Weights sum to {total:.6f} on {dt}, expected 1.0"
        )


def test_trend_filter_weights_sum_to_one_throughout():
    """Weights must sum to 1.0 at every rebalance regardless of regime."""
    prices, universe, benchmark, defensive = _make_trend_prices()

    _, _, _, positions = _trend_filter(
        prices,
        universe_tickers=universe,
        benchmark_ticker=benchmark,
        defensive_ticker=defensive,
    )

    totals: dict[str, float] = defaultdict(float)
    for pos in positions:
        totals[pos["date"]] += pos["weight"]

    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-9, (
            f"Weights sum to {total:.6f} on {dt}, expected 1.0"
        )


def test_trend_filter_insufficient_benchmark_history_raises():
    """Fewer than 200 benchmark data points must raise ValueError."""
    n = _TREND_SMA_WINDOW - 1   # 199 rows
    rng = np.random.default_rng(0)
    prices = pd.DataFrame(
        {
            "T0":  100.0 * (1 + rng.normal(0, 0.01, n)).cumprod(),
            "SPY": np.linspace(100.0, 120.0, n),
            "TLT": np.linspace(100.0, 110.0, n),
        },
        index=pd.bdate_range("2020-01-01", periods=n),
    )
    with pytest.raises(ValueError, match="200"):
        _trend_filter(
            prices,
            universe_tickers=["T0"],
            benchmark_ticker="SPY",
            defensive_ticker="TLT",
        )


def test_trend_filter_missing_defensive_raises():
    """Missing defensive ticker in price data should raise ValueError."""
    prices, universe, benchmark, _ = _make_trend_prices()
    prices_no_tlt = prices.drop(columns=["TLT"])

    with pytest.raises(ValueError, match="TLT"):
        _trend_filter(
            prices_no_tlt,
            universe_tickers=universe,
            benchmark_ticker=benchmark,
            defensive_ticker="TLT",
        )
