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
_SMOKE_END   = "2020-12-31"
_N_BDAYS     = 1044  # ≈ 4 calendar years of business days

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
  }


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
  totals: dict[str, float] = defaultdict(float)
  for pos in result.position_rows:
    totals[pos["date"]] += pos["weight"]
  for dt, total in totals.items():
    assert abs(total - 1.0) < 1e-8, (
      f"{strategy_id}: weights sum to {total:.9f} on {dt}"
    )


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
  prices = pd.DataFrame({
    "A":     100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
    "B":     100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
    "BENCH": bench,
    "TLT":   np.linspace(100, 135, n),
  }, index=dates)

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
  prices = pd.DataFrame({
    "A":     100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
    "B":     100.0 * (1 + rng.normal(0.0003, 0.01, n)).cumprod(),
    "BENCH": bench,
    "TLT":   np.linspace(100, 150, n),
  }, index=dates)

  # Only check the last 6 months of the run (deep into the downtrend / risk-off)
  run = _fake_run(
    "trend_filter", ["A", "B"],
    start=_SMOKE_START, end="2020-12-31", top_n=2,
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
