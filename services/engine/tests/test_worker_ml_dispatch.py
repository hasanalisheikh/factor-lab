from __future__ import annotations

import builtins
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import pytest

from factorlab_engine.supabase_io import Job
from factorlab_engine.worker import _process_job


@dataclass
class _FailureRecord:
  duration_seconds: int
  error_message: str
  stage: str


class _FakeIO:
  def __init__(self, run: dict[str, Any], prices: pd.DataFrame) -> None:
    self._run = run
    self._prices = prices
    self.success_called = False
    self.failure: _FailureRecord | None = None
    self.run_metadata_payload: dict[str, Any] | None = None

  def claim_job(self, job: Job) -> bool:  # noqa: ARG002
    return True

  def update_job_progress(self, job_id: str, *, stage: str, progress: int) -> None:  # noqa: ARG002
    return

  def fetch_run(self, run_id: str) -> dict[str, Any] | None:  # noqa: ARG002
    return dict(self._run)

  def update_run_universe_symbols(self, run_id: str, symbols: list[str]) -> None:  # noqa: ARG002
    return

  def fetch_prices_frame(self, tickers: list[str], start_date: str, end_date: str) -> pd.DataFrame:  # noqa: ARG002
    return self._prices[tickers].copy()

  def update_run_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:  # noqa: ARG002
    self.run_metadata_payload = metadata

  def save_success(self, **kwargs: Any) -> None:  # noqa: ARG002
    self.success_called = True

  def save_failure(
    self,
    job: Job,  # noqa: ARG002
    duration_seconds: int,
    error_message: str,
    *,
    stage: str = "report",
  ) -> None:
    self.failure = _FailureRecord(
      duration_seconds=duration_seconds,
      error_message=error_message,
      stage=stage,
    )


def _make_prices() -> pd.DataFrame:
  rng = np.random.default_rng(123)
  dates = pd.bdate_range("2015-01-02", "2026-02-27")
  cols = ["SPY", "AAA", "BBB", "CCC"]
  out: dict[str, np.ndarray] = {}
  for col in cols:
    daily = rng.normal(0.00025, 0.01, size=len(dates))
    out[col] = 100.0 * (1.0 + daily).cumprod()
  return pd.DataFrame(out, index=dates)


def _lgbm_available() -> bool:
  try:
    import lightgbm  # noqa: F401
    return True
  except (ImportError, OSError):
    return False


def test_process_job_lightgbm_fails_loudly_when_lightgbm_missing(monkeypatch):
  run = {
    "id": "run-lgbm-fail",
    "name": "LGBM test",
    "strategy_id": "ml_lightgbm",
    "status": "queued",
    "start_date": "2021-01-01",
    "end_date": "2025-12-31",
    "benchmark": "SPY",
    "benchmark_ticker": "SPY",
    "costs_bps": 10,
    "top_n": 2,
    "universe": "ETF8",
    "universe_symbols": ["AAA", "BBB", "CCC"],
    "run_params": {},
    "run_metadata": {},
  }
  io = _FakeIO(run=run, prices=_make_prices())
  job = Job(id="job-lgbm-fail", run_id="run-lgbm-fail", name="job")

  real_import = builtins.__import__

  def _block_lightgbm(name: str, *args, **kwargs):
    if name == "lightgbm":
      raise ImportError("lightgbm intentionally blocked by test")
    return real_import(name, *args, **kwargs)

  monkeypatch.setattr(builtins, "__import__", _block_lightgbm)

  _process_job(io, job)

  assert not io.success_called
  assert io.failure is not None
  assert "ml_lightgbm requires LightGBM" in io.failure.error_message


@pytest.mark.skipif(not _lgbm_available(), reason="LightGBM is unavailable in this environment")
def test_process_job_lightgbm_persists_model_impl_when_available():
  run = {
    "id": "run-lgbm-ok",
    "name": "LGBM test",
    "strategy_id": "ml_lightgbm",
    "status": "queued",
    "start_date": "2021-01-01",
    "end_date": "2025-12-31",
    "benchmark": "SPY",
    "benchmark_ticker": "SPY",
    "costs_bps": 10,
    "top_n": 2,
    "universe": "ETF8",
    "universe_symbols": ["AAA", "BBB", "CCC"],
    "run_params": {},
    "run_metadata": {},
  }
  io = _FakeIO(run=run, prices=_make_prices())
  job = Job(id="job-lgbm-ok", run_id="run-lgbm-ok", name="job")

  _process_job(io, job)

  assert io.failure is None
  assert io.success_called
  assert io.run_metadata_payload is not None
  assert io.run_metadata_payload.get("model_impl") == "lightgbm"
