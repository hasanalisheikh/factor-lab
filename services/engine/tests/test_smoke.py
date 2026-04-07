"""Smoke-test harness: every strategy on synthetic price data.

Each test:
  - Runs the strategy end-to-end on toy data (no network, no DB)
  - Asserts equity_rows / metrics / positions are non-empty and correct
  - Asserts weights sum to 1.0 at every recorded rebalance

All baseline tests use a run window of 2017-01-01 → 2020-12-31 (≈ 1461 calendar
days, ≈ 1044 business days) to satisfy _ensure_min_history (≥730 days, ≥500 pts).
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.ml import run_walk_forward
from factorlab_engine.worker import _build_baseline_result

# ---------------------------------------------------------------------------
# LightGBM availability check
# ---------------------------------------------------------------------------


def _lgbm_available() -> bool:
    try:
        import lightgbm  # noqa: F401

        return True
    except (ImportError, OSError):
        return False


_requires_lgbm = pytest.mark.skipif(
    not _lgbm_available(),
    reason="LightGBM native library not available (install libomp via `brew install libomp`)",
)

# ---------------------------------------------------------------------------
# Constants — shared across all smoke tests
# ---------------------------------------------------------------------------

_SMOKE_START = "2017-01-01"
_SMOKE_END = "2020-12-31"
_N_BDAYS = 1044  # ≈ 4 calendar years of business days

# ---------------------------------------------------------------------------
# Synthetic price factory
# ---------------------------------------------------------------------------


def _make_prices(
    tickers: list[str],
    start: str = _SMOKE_START,
    periods: int = _N_BDAYS,
    seed: int = 0,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=periods)
    data: dict[str, np.ndarray] = {}
    for t in tickers:
        ret = rng.normal(0.0003, 0.01, periods)
        data[t] = 100.0 * (1.0 + ret).cumprod()
    return pd.DataFrame(data, index=dates)


def _fake_run(
    strategy_id: str,
    tickers: list[str],
    *,
    start: str = _SMOKE_START,
    end: str = _SMOKE_END,
    top_n: int = 3,
    costs_bps: float = 10.0,
    initial_capital: float = 100_000.0,
) -> dict:
    return {
        "id": f"smoke-{strategy_id}",
        "strategy_id": strategy_id,
        "universe_symbols": tickers,
        "benchmark": "BENCH",
        "benchmark_ticker": "BENCH",
        "costs_bps": costs_bps,
        "top_n": top_n,
        "start_date": start,
        "end_date": end,
        "run_params": {"initial_capital": initial_capital},
    }


class _FakeSupabaseTable:
    """No-op Supabase table stub for upsert calls in tests."""

    def upsert(self, *_args, **_kwargs):
        return self

    def execute(self):
        return self


class _FakeSupabaseClient:
    def table(self, _name: str) -> _FakeSupabaseTable:
        return _FakeSupabaseTable()


class _FakeIO:
    """SupabaseIO stub — serves pre-built synthetic prices; no network calls."""

    def __init__(self, prices: pd.DataFrame) -> None:
        self._prices = prices

    def fetch_prices_frame(
        self, tickers: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        cols = [t for t in tickers if t in self._prices.columns]
        if not cols:
            return pd.DataFrame()
        sub = self._prices[cols]
        mask = (self._prices.index >= pd.Timestamp(start_date)) & (
            self._prices.index <= pd.Timestamp(end_date)
        )
        return sub[mask]

    def update_run_universe_symbols(self, *_args) -> None:
        pass

    @property
    def client(self):
        return _FakeSupabaseClient()


# ---------------------------------------------------------------------------
# Common smoke assertions
# ---------------------------------------------------------------------------


def _assert_smoke(result, strategy_id: str) -> None:
    assert len(result.equity_rows) > 0, f"{strategy_id}: no equity rows"
    assert len(result.metrics) > 0, f"{strategy_id}: no metrics"
    assert result.position_rows is not None and len(result.position_rows) > 0, (
        f"{strategy_id}: no position rows"
    )
    m = result.metrics
    assert np.isfinite(m["cagr"]), f"{strategy_id}: non-finite cagr"
    assert np.isfinite(m["sharpe"]), f"{strategy_id}: non-finite sharpe"
    assert -1.0 <= m["max_drawdown"] <= 0.0, f"{strategy_id}: max_drawdown out of range"
    assert m["turnover"] >= 0.0, f"{strategy_id}: negative turnover"
    for row in result.equity_rows:
        assert "portfolio" in row and "benchmark" in row
        assert np.isfinite(row["portfolio"]), f"{strategy_id}: non-finite portfolio value"
        assert np.isfinite(row["benchmark"]), f"{strategy_id}: non-finite benchmark value"
    from factorlab_engine.worker import _ALL_CASH_SENTINEL

    # Group positions by date; dates covered solely by the _CASH sentinel are
    # valid all-cash rebalances (weight=0 is expected; no 1.0 sum required).
    by_date: dict[str, list[dict]] = defaultdict(list)
    for pos in result.position_rows:
        by_date[pos["date"]].append(pos)
    for dt, rows in by_date.items():
        if len(rows) == 1 and rows[0]["symbol"] == _ALL_CASH_SENTINEL:
            assert rows[0]["weight"] == 0.0, (
                f"{strategy_id}: _CASH sentinel must have weight=0 on {dt}"
            )
        else:
            total = sum(r["weight"] for r in rows)
            assert abs(total - 1.0) < 1e-8, f"{strategy_id}: weights sum to {total:.9f} on {dt}"


# ---------------------------------------------------------------------------
# Smoke: equal_weight
# ---------------------------------------------------------------------------


def test_smoke_equal_weight(monkeypatch):
    tickers = ["A", "B", "C", "D", "BENCH"]
    prices = _make_prices(tickers, seed=0)
    run = _fake_run("equal_weight", ["A", "B", "C", "D"])
    io = _FakeIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)
    _assert_smoke(result, "equal_weight")


# ---------------------------------------------------------------------------
# Smoke: momentum_12_1
# ---------------------------------------------------------------------------


def test_smoke_momentum_12_1(monkeypatch):
    tickers = ["A", "B", "C", "D", "E", "BENCH"]
    prices = _make_prices(tickers, seed=1)
    run = _fake_run("momentum_12_1", ["A", "B", "C", "D", "E"], top_n=2)
    io = _FakeIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)
    _assert_smoke(result, "momentum_12_1")


def test_baseline_fetches_warmup_history_and_trims_output(monkeypatch):
    tickers = ["A", "B", "C", "D", "BENCH"]
    prices = _make_prices(tickers, start="2015-01-01", periods=1_600, seed=11)
    requests: list[tuple[str, str]] = []

    class _RecordingIO(_FakeIO):
        def fetch_prices_frame(
            self, tickers: list[str], start_date: str, end_date: str
        ) -> pd.DataFrame:
            requests.append((start_date, end_date))
            return super().fetch_prices_frame(tickers, start_date, end_date)

    run = _fake_run(
        "momentum_12_1",
        ["A", "B", "C", "D"],
        start="2018-01-02",
        end="2020-12-31",
        top_n=2,
    )
    io = _RecordingIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)

    assert requests, "Expected the engine to request price history"
    assert requests[0][0] < run["start_date"], "Expected warmup fetch before the run start"
    assert requests[0][1] == run["end_date"]
    assert result.equity_rows[0]["date"] == run["start_date"]
    assert result.equity_rows[0]["portfolio"] == pytest.approx(100_000.0)
    assert all(pos["date"] >= run["start_date"] for pos in result.position_rows or [])


# ---------------------------------------------------------------------------
# Staleness check: engine downloads fresh prices when DB prices are stale
# ---------------------------------------------------------------------------


def test_baseline_downloads_when_prices_stale(monkeypatch):
    """If DB prices end >5 calendar days before run_end, the engine must fall
    back to _download_prices so the equity curve spans the full run window."""
    tickers = ["A", "B", "C", "D", "BENCH"]
    run_end = _SMOKE_END  # "2020-12-31"

    # Stale prices: generated with the default period count, which ends ~10
    # business days before run_end.  _make_prices uses pd.bdate_range(start,
    # periods=…), so the actual last date depends on the seed/count.  We
    # truncate explicitly to guarantee the last date is at least 10 days before
    # run_end.
    full_prices = _make_prices(tickers, seed=99)
    cutoff = pd.Timestamp(run_end) - pd.Timedelta(days=10)
    stale_prices = full_prices[full_prices.index <= cutoff]

    # Fresh prices cover all of full_prices (past run_end)
    fresh_prices = full_prices

    download_calls: list[tuple] = []

    import factorlab_engine.worker as w

    def fake_download(start: str, end: str, tkrs: list) -> pd.DataFrame:  # noqa: ARG001
        download_calls.append((start, end))
        return fresh_prices

    monkeypatch.setattr(w, "_download_prices", fake_download)

    run = _fake_run("equal_weight", ["A", "B", "C", "D"])
    io = _FakeIO(stale_prices)
    result = _build_baseline_result(io, run)

    assert download_calls, (
        "Expected _download_prices to be called when DB prices are stale "
        f"(last DB date: {stale_prices.index.max().date()}, run_end: {run_end})"
    )
    # The equity curve must end close to run_end (within 5 business days)
    last_equity_date = result.equity_rows[-1]["date"]
    assert last_equity_date >= "2020-12-21", (
        f"Expected equity curve to reach near {run_end}, got {last_equity_date}"
    )


# ---------------------------------------------------------------------------
# Smoke: low_vol
# ---------------------------------------------------------------------------


def test_smoke_low_vol(monkeypatch):
    tickers = ["A", "B", "C", "D", "BENCH"]
    prices = _make_prices(tickers, seed=2)
    run = _fake_run("low_vol", ["A", "B", "C", "D"], top_n=2)
    io = _FakeIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)
    _assert_smoke(result, "low_vol")


# ---------------------------------------------------------------------------
# Smoke: trend_filter (mixed regime)
# ---------------------------------------------------------------------------


def test_smoke_trend_filter(monkeypatch):
    # Build deterministic prices with a clear uptrend → downtrend benchmark.
    # 1044 business days:
    #   Days   0–519 : uptrend (100 → 250)
    #   Days 520–1043: downtrend (250 → 60)
    n = _N_BDAYS
    rng = np.random.default_rng(3)
    dates = pd.bdate_range(_SMOKE_START, periods=n)
    bench = np.concatenate([np.linspace(100, 250, n // 2), np.linspace(250, 60, n - n // 2)])
    prices = pd.DataFrame(
        {
            "A": 100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
            "B": 100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
            "BENCH": bench,
            "TLT": np.linspace(100, 135, n),
        },
        index=dates,
    )

    run = _fake_run("trend_filter", ["A", "B"], top_n=2)
    io = _FakeIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)
    _assert_smoke(result, "trend_filter")


# ---------------------------------------------------------------------------
# Smoke: trend_filter → risk-off positions must be 100% TLT
# ---------------------------------------------------------------------------


def test_smoke_trend_filter_risk_off_is_tlt(monkeypatch):
    """In the tail of a long downtrend the 200-day SMA is above price → 100% TLT."""
    n = _N_BDAYS
    rng = np.random.default_rng(7)
    dates = pd.bdate_range(_SMOKE_START, periods=n)
    # Benchmark rises briefly (days 0–200) then crashes hard (days 200–1044).
    # After ~400 days in the downtrend the SMA200 will be well above the current price.
    bench = np.concatenate([np.linspace(100, 130, 200), np.linspace(130, 15, n - 200)])
    prices = pd.DataFrame(
        {
            "A": 100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
            "B": 100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
            "BENCH": bench,
            "TLT": np.linspace(100, 150, n),
        },
        index=dates,
    )

    # Only check the last 6 months of the run (deep into the downtrend / risk-off)
    run = _fake_run(
        "trend_filter",
        ["A", "B"],
        start=_SMOKE_START,
        end="2020-12-31",
        top_n=2,
    )
    io = _FakeIO(prices)

    import factorlab_engine.worker as w

    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    result = _build_baseline_result(io, run)
    assert result.position_rows is not None and len(result.position_rows) > 0

    # Positions recorded after the crash is well-established (day 200+ ≈ mid-2018)
    # By 2020 the SMA200 will be far above the crashing benchmark.
    late_positions = [p for p in result.position_rows if p["date"] >= "2020-01-01"]
    assert len(late_positions) > 0, "No positions found in the late risk-off window"

    for pos in late_positions:
        assert pos["symbol"] == "TLT", (
            f"Expected 100% TLT in deep risk-off (benchmark at ~{bench[-1]:.0f}), "
            f"got {pos['symbol']} on {pos['date']}"
        )
        assert abs(pos["weight"] - 1.0) < 1e-9


# ---------------------------------------------------------------------------
# Smoke: ml_ridge
# ---------------------------------------------------------------------------


def test_smoke_ml_ridge():
    tickers = [f"T{i}" for i in range(5)] + ["BENCH"]
    # ML needs a 5-year warmup before run.start_date AND prices must extend past
    # run.end_date by ≥1 month (target_return shift).  Use 10 years to be safe.
    n = int(10 * 252)
    prices = _make_prices(tickers, start="2011-01-01", periods=n, seed=4)

    result = run_walk_forward(
        run_id="smoke-ml_ridge",
        strategy="ml_ridge",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-12-31",
        benchmark_ticker="BENCH",
        top_n=3,
        cost_bps=10.0,
    )

    assert len(result.equity_rows) > 0, "ml_ridge: no equity rows"
    assert len(result.position_rows) > 0, "ml_ridge: no positions"
    assert result.equity_rows[0]["date"] == "2018-01-01"
    assert result.equity_rows[-1]["date"] == "2019-12-31"
    for row in result.equity_rows:
        assert "portfolio" in row and "benchmark" in row
        assert np.isfinite(row["portfolio"]) and np.isfinite(row["benchmark"])
    totals: dict[str, float] = defaultdict(float)
    for pos in result.position_rows:
        totals[pos["date"]] += pos["weight"]
    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-8, f"ml_ridge: weights sum to {total:.9f} on {dt}"


# ---------------------------------------------------------------------------
# Smoke: ml_lightgbm (skipped when LightGBM native lib is missing)
# ---------------------------------------------------------------------------


@_requires_lgbm
def test_smoke_ml_lightgbm():
    tickers = [f"T{i}" for i in range(5)] + ["BENCH"]
    n = int(10 * 252)
    prices = _make_prices(tickers, start="2011-01-01", periods=n, seed=5)

    result = run_walk_forward(
        run_id="smoke-ml_lightgbm",
        strategy="ml_lightgbm",
        prices=prices,
        start_date="2018-01-01",
        end_date="2019-12-31",
        benchmark_ticker="BENCH",
        top_n=3,
        cost_bps=10.0,
    )

    assert len(result.equity_rows) > 0, "ml_lightgbm: no equity rows"
    assert len(result.position_rows) > 0, "ml_lightgbm: no positions"
    assert result.equity_rows[0]["date"] == "2018-01-01"
    assert result.equity_rows[-1]["date"] == "2019-12-31"
    assert result.metadata.get("feature_importance"), "ml_lightgbm: no feature_importance"
    totals: dict[str, float] = defaultdict(float)
    for pos in result.position_rows:
        totals[pos["date"]] += pos["weight"]
    for dt, total in totals.items():
        assert abs(total - 1.0) < 1e-8, f"ml_lightgbm: weights sum to {total:.9f} on {dt}"


# ---------------------------------------------------------------------------
# P1 Regression: initial_capital truly scales the equity curve
# ---------------------------------------------------------------------------


def test_initial_capital_scales_equity_curve(monkeypatch):
    """Equity curve start NAV must equal initial_capital, not always $100K.

    Two equal_weight runs with different initial_capital values must produce
    equity curves that are an exact scalar multiple of each other on every date.
    Both the portfolio and benchmark series must scale identically.
    """
    import factorlab_engine.worker as w

    tickers = ["A", "B", "C", "BENCH"]
    prices = _make_prices(tickers, seed=42)
    io = _FakeIO(prices)
    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    run_100k = _fake_run("equal_weight", ["A", "B", "C"], initial_capital=100_000.0)
    run_250k = _fake_run("equal_weight", ["A", "B", "C"], initial_capital=250_000.0)

    result_100k = _build_baseline_result(io, run_100k)
    result_250k = _build_baseline_result(io, run_250k)

    # Starting NAV must equal configured capital exactly (first day return is zeroed)
    assert result_100k.equity_rows[0]["portfolio"] == pytest.approx(100_000.0)
    assert result_250k.equity_rows[0]["portfolio"] == pytest.approx(250_000.0)

    # Benchmark must also be rebased to the same capital
    assert result_100k.equity_rows[0]["benchmark"] == pytest.approx(100_000.0)
    assert result_250k.equity_rows[0]["benchmark"] == pytest.approx(250_000.0)

    # Every row must be exactly 2.5× larger for the 250K run
    scale = 250_000.0 / 100_000.0
    assert len(result_100k.equity_rows) == len(result_250k.equity_rows)
    for r100, r250 in zip(result_100k.equity_rows, result_250k.equity_rows):
        assert r100["date"] == r250["date"]
        assert r250["portfolio"] == pytest.approx(r100["portfolio"] * scale, rel=1e-9)
        assert r250["benchmark"] == pytest.approx(r100["benchmark"] * scale, rel=1e-9)

    # Percentage metrics must be unchanged
    m100 = result_100k.metrics
    m250 = result_250k.metrics
    for key in ("cagr", "sharpe", "max_drawdown", "volatility", "win_rate", "calmar"):
        assert m100[key] == pytest.approx(m250[key], rel=1e-9), f"metric {key} changed"


# ---------------------------------------------------------------------------
# P2 Regression: _CASH sentinel persisted for all-cash rebalance dates
# ---------------------------------------------------------------------------


def test_momentum_12_1_emits_all_cash_sentinel(monkeypatch):
    """momentum_12_1 must emit a _CASH sentinel row for every rebalance date
    where all momentum scores are <= 0 (all-cash state).

    We force all-cash by using prices that decline uniformly so that the
    12-month-minus-1-month momentum score is always negative.
    """
    import factorlab_engine.worker as w
    from factorlab_engine.worker import _ALL_CASH_SENTINEL

    n = _N_BDAYS
    dates = pd.bdate_range(_SMOKE_START, periods=n)
    # Uniformly declining prices → all momentum scores negative throughout
    prices = pd.DataFrame(
        {
            "A": np.linspace(200, 50, n),
            "B": np.linspace(180, 40, n),
            "BENCH": np.linspace(150, 60, n),
        },
        index=dates,
    )
    io = _FakeIO(prices)
    monkeypatch.setattr(w, "_download_prices", lambda *a, **kw: prices)

    run = _fake_run("momentum_12_1", ["A", "B"], top_n=2)
    result = _build_baseline_result(io, run)

    cash_rows = [p for p in result.position_rows if p["symbol"] == _ALL_CASH_SENTINEL]
    assert len(cash_rows) > 0, "Expected _CASH sentinel rows for all-cash rebalances"
    for row in cash_rows:
        assert row["weight"] == 0.0, "_CASH sentinel must have weight=0"
        assert row["date"] >= run["start_date"], "_CASH row must be within run window"

    # No real asset row may have the sentinel symbol
    real_rows = [p for p in result.position_rows if p["symbol"] != _ALL_CASH_SENTINEL]
    for row in real_rows:
        assert row["symbol"] != _ALL_CASH_SENTINEL
        assert row["weight"] > 0.0, "Real position rows must have positive weight"
