from __future__ import annotations

from typing import Any

import pandas as pd

from factorlab_engine.supabase_io import SupabaseIO


class _Result:
  def __init__(self, data: list[dict[str, Any]] | None = None) -> None:
    self.data = data or []


class _JobsTable:
  def __init__(self) -> None:
    self.update_payloads: list[dict[str, Any]] = []
    self._pending_update: dict[str, Any] | None = None

  def select(self, _fields: str) -> "_JobsTable":
    return self

  def update(self, payload: dict[str, Any]) -> "_JobsTable":
    self._pending_update = dict(payload)
    return self

  def eq(self, _column: str, _value: Any) -> "_JobsTable":
    return self

  def lte(self, _column: str, _value: Any) -> "_JobsTable":
    return self

  def lt(self, _column: str, _value: Any) -> "_JobsTable":
    return self

  @property
  def not_(self) -> "_JobsTable":
    return self

  def is_(self, _column: str, _value: Any) -> "_JobsTable":
    return self

  def execute(self) -> _Result:
    if self._pending_update is not None:
      self.update_payloads.append(self._pending_update)
      self._pending_update = None
      return _Result([{"id": "job-1"}])
    return _Result([{"id": "job-1", "attempt_count": 2}])


class _FakeClient:
  def __init__(self, jobs_table: _JobsTable) -> None:
    self._jobs_table = jobs_table

  def table(self, name: str) -> _JobsTable:
    assert name == "jobs"
    return self._jobs_table


class _FakeIngestClient:
  def __init__(self, ingest_table: _JobsTable) -> None:
    self._ingest_table = ingest_table

  def table(self, name: str) -> _JobsTable:
    assert name == "data_ingest_jobs"
    return self._ingest_table


class _PricesTable:
  def __init__(self, rows: list[dict[str, Any]]) -> None:
    self._rows = rows
    self._range = (0, len(rows) - 1)

  def select(self, _fields: str) -> "_PricesTable":
    return self

  def in_(self, _column: str, _values: list[str]) -> "_PricesTable":
    return self

  def gte(self, _column: str, _value: str) -> "_PricesTable":
    return self

  def lte(self, _column: str, _value: str) -> "_PricesTable":
    return self

  def order(self, _column: str, desc: bool = False) -> "_PricesTable":  # noqa: ARG002
    return self

  def range(self, start: int, end: int) -> "_PricesTable":
    self._range = (start, end)
    return self

  def execute(self) -> _Result:
    start, end = self._range
    return _Result(self._rows[start : end + 1])


class _FakePricesClient:
  def __init__(self, prices_table: _PricesTable) -> None:
    self._prices_table = prices_table

  def table(self, name: str) -> _PricesTable:
    assert name == "prices"
    return self._prices_table


def test_requeue_due_for_retry_resets_legacy_jobs_to_ingest_stage() -> None:
  jobs_table = _JobsTable()
  io = object.__new__(SupabaseIO)
  io.client = _FakeClient(jobs_table)

  io.requeue_due_for_retry(max_attempts=5)

  assert len(jobs_table.update_payloads) == 1
  payload = jobs_table.update_payloads[0]
  assert payload["status"] == "queued"
  assert payload["stage"] == "ingest"
  assert payload["progress"] == 0
  assert payload["next_retry_at"] is None
  assert payload["error_message"] is None
  assert isinstance(payload["updated_at"], str)


def test_requeue_due_data_ingest_resets_retrying_jobs_to_queued() -> None:
  ingest_table = _JobsTable()
  io = object.__new__(SupabaseIO)
  io.client = _FakeIngestClient(ingest_table)

  io.requeue_due_data_ingest(max_attempts=5)

  assert len(ingest_table.update_payloads) == 1
  payload = ingest_table.update_payloads[0]
  assert payload["status"] == "queued"
  assert payload["stage"] is None
  assert payload["progress"] == 0
  assert payload["next_retry_at"] is None
  assert payload["error"] is None
  assert isinstance(payload["updated_at"], str)
  assert isinstance(payload["last_heartbeat_at"], str)


def test_legacy_data_ingest_payload_maps_new_fields_to_legacy_schema() -> None:
  io = object.__new__(SupabaseIO)

  payload = io._legacy_data_ingest_payload({
    "status": "retrying",
    "stage": "upsert_prices",
    "request_mode": "manual",
    "batch_id": "batch-1",
    "target_cutoff_date": "2026-03-11",
    "requested_by": "cron:daily",
    "last_heartbeat_at": "2026-03-12T00:00:00Z",
    "requested_by_run_id": "run-1",
  })

  assert payload == {
    "status": "failed",
    "stage": "upsert",
    "requested_by_run_id": "run-1",
  }


def test_fetch_prices_frame_paginates_beyond_supabase_default_limit() -> None:
  rows: list[dict[str, Any]] = []
  dates = pd.bdate_range("2021-01-01", periods=600)
  for dt in dates:
    rows.append({"ticker": "AAA", "date": dt.strftime("%Y-%m-%d"), "adj_close": 100.0})
    rows.append({"ticker": "BBB", "date": dt.strftime("%Y-%m-%d"), "adj_close": 200.0})

  io = object.__new__(SupabaseIO)
  io.client = _FakePricesClient(_PricesTable(rows))

  frame = io.fetch_prices_frame(["AAA", "BBB"], "2021-01-01", "2023-12-31")

  assert list(frame.columns) == ["AAA", "BBB"]
  assert len(frame) == 600
  assert frame.index.min() == dates.min()
  assert frame.index.max() == dates.max()
