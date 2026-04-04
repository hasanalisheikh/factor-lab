from __future__ import annotations

from typing import Any
from unittest.mock import patch

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

    def eq(self, column: str, value: str) -> "_PricesTable":
        filtered = [r for r in self._rows if r.get(column) == value]
        return _PricesTable(filtered)

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


class _RetryablePricesTable:
    def __init__(self, rows: list[dict[str, Any]], failures_remaining: int = 1) -> None:
        self._rows = rows
        self._range = (0, len(rows) - 1)
        self.failures_remaining = failures_remaining
        self.execute_calls = 0

    def select(self, _fields: str) -> "_RetryablePricesTable":
        return self

    def eq(self, _column: str, _value: str) -> "_RetryablePricesTable":
        return self

    def gte(self, _column: str, _value: str) -> "_RetryablePricesTable":
        return self

    def lte(self, _column: str, _value: str) -> "_RetryablePricesTable":
        return self

    def order(self, _column: str, desc: bool = False) -> "_RetryablePricesTable":  # noqa: ARG002
        return self

    def range(self, start: int, end: int) -> "_RetryablePricesTable":
        self._range = (start, end)
        return self

    def execute(self) -> _Result:
        self.execute_calls += 1
        if self.failures_remaining > 0:
            self.failures_remaining -= 1
            raise RuntimeError(
                "{'message': 'canceling statement due to statement timeout', 'code': '57014'}"
            )
        start, end = self._range
        return _Result(self._rows[start : end + 1])


class _RunsTable:
    def __init__(self, failures_remaining: int = 0) -> None:
        self.failures_remaining = failures_remaining
        self.update_payloads: list[dict[str, Any]] = []
        self._pending_update: dict[str, Any] | None = None

    def update(self, payload: dict[str, Any]) -> "_RunsTable":
        self._pending_update = dict(payload)
        return self

    def eq(self, _column: str, _value: Any) -> "_RunsTable":
        return self

    def execute(self) -> _Result:
        if self.failures_remaining > 0:
            self.failures_remaining -= 1
            raise RuntimeError(
                "{'message': 'canceling statement due to statement timeout', 'code': '57014'}"
            )
        if self._pending_update is not None:
            self.update_payloads.append(self._pending_update)
            self._pending_update = None
        return _Result([{"id": "run-1"}])


class _FakeRunsClient:
    def __init__(self, runs_table: _RunsTable) -> None:
        self._runs_table = runs_table

    def table(self, name: str) -> _RunsTable:
        assert name == "runs"
        return self._runs_table


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

    payload = io._legacy_data_ingest_payload(
        {
            "status": "retrying",
            "stage": "upsert_prices",
            "request_mode": "manual",
            "batch_id": "batch-1",
            "target_cutoff_date": "2026-03-11",
            "requested_by": "cron:daily",
            "last_heartbeat_at": "2026-03-12T00:00:00Z",
            "requested_by_run_id": "run-1",
        }
    )

    assert payload == {
        "status": "failed",
        "stage": "upsert",
        "requested_by_run_id": "run-1",
    }


# ---------------------------------------------------------------------------
# try_finalize_scheduled_refresh_batch — relaxed finalization logic
# ---------------------------------------------------------------------------


class _BatchJobsTable:
    """Mock for data_ingest_jobs.select(…).eq(…).execute() in finalize tests."""

    def __init__(self, batch_rows: list[dict[str, Any]]) -> None:
        self._rows = batch_rows

    def select(self, _fields: str) -> "_BatchJobsTable":
        return self

    def eq(self, _col: str, _val: Any) -> "_BatchJobsTable":
        return self

    def execute(self) -> _Result:
        return _Result(self._rows)


class _DataStateTable:
    def __init__(self) -> None:
        self.upserted: list[dict[str, Any]] = []

    def upsert(self, payload: dict[str, Any]) -> "_DataStateTable":
        self.upserted.append(dict(payload))
        return self

    def execute(self) -> _Result:
        return _Result()


class _RpcProxy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self) -> _Result:
        return _Result()


class _FinalizeFakeClient:
    def __init__(self, batch_rows: list[dict[str, Any]]) -> None:
        self._batch_table = _BatchJobsTable(batch_rows)
        self.data_state = _DataStateTable()
        self.rpc_proxy = _RpcProxy()

    def table(self, name: str) -> Any:
        if name == "data_ingest_jobs":
            return self._batch_table
        if name == "data_state":
            return self.data_state
        raise AssertionError(f"unexpected table: {name}")

    def rpc(self, fn: str, params: dict[str, Any]) -> _RpcProxy:
        self.rpc_proxy.calls.append((fn, params))
        return self.rpc_proxy


def _make_ingest_job(batch_id: str = "batch-1", target: str = "2026-03-11") -> Any:
    from factorlab_engine.supabase_io import DataIngestJob

    return DataIngestJob(
        id="job-1",
        symbol="SPY",
        start_date="2026-03-01",
        end_date=target,
        request_mode="daily",
        batch_id=batch_id,
        target_cutoff_date=target,
        requested_by="cron:daily-refresh",
    )


def test_finalize_all_succeeded_advances_cutoff() -> None:
    """All jobs succeeded → data_state is advanced."""
    rows = [
        {"id": "j1", "symbol": "SPY", "status": "succeeded"},
        {"id": "j2", "symbol": "AAPL", "status": "succeeded"},
    ]
    client = _FinalizeFakeClient(rows)
    io = object.__new__(SupabaseIO)
    io.client = client

    io.try_finalize_scheduled_refresh_batch(_make_ingest_job())

    assert len(client.data_state.upserted) == 1
    assert client.data_state.upserted[0]["data_cutoff_date"] == "2026-03-11"


def test_finalize_blocked_non_benchmark_still_advances_cutoff() -> None:
    """A blocked non-benchmark ticker must not prevent cutoff advancement."""
    rows = [
        {"id": "j1", "symbol": "SPY", "status": "succeeded"},
        {"id": "j2", "symbol": "QQQ", "status": "succeeded"},
        {"id": "j3", "symbol": "AAPL", "status": "blocked"},  # non-benchmark, terminal
    ]
    client = _FinalizeFakeClient(rows)
    io = object.__new__(SupabaseIO)
    io.client = client

    io.try_finalize_scheduled_refresh_batch(_make_ingest_job())

    assert len(client.data_state.upserted) == 1
    assert client.data_state.upserted[0]["data_cutoff_date"] == "2026-03-11"


def test_finalize_blocked_benchmark_does_not_advance_cutoff() -> None:
    """A blocked benchmark ticker must block cutoff advancement."""
    rows = [
        {"id": "j1", "symbol": "SPY", "status": "blocked"},  # benchmark — must not block
        {"id": "j2", "symbol": "AAPL", "status": "succeeded"},
    ]
    client = _FinalizeFakeClient(rows)
    io = object.__new__(SupabaseIO)
    io.client = client

    io.try_finalize_scheduled_refresh_batch(_make_ingest_job())

    assert len(client.data_state.upserted) == 0


def test_finalize_queued_job_does_not_advance_cutoff() -> None:
    """An in-flight (queued) job must prevent finalization."""
    rows = [
        {"id": "j1", "symbol": "SPY", "status": "succeeded"},
        {"id": "j2", "symbol": "AAPL", "status": "queued"},  # still in flight
    ]
    client = _FinalizeFakeClient(rows)
    io = object.__new__(SupabaseIO)
    io.client = client

    io.try_finalize_scheduled_refresh_batch(_make_ingest_job())

    assert len(client.data_state.upserted) == 0


def test_finalize_no_batch_id_is_no_op() -> None:
    """Jobs without a batch_id (legacy / preflight) must be skipped."""
    from factorlab_engine.supabase_io import DataIngestJob

    job = DataIngestJob(
        id="job-1",
        symbol="SPY",
        start_date="2026-03-01",
        end_date="2026-03-11",
        request_mode="daily",
        batch_id=None,  # no batch
        target_cutoff_date="2026-03-11",
    )
    client = _FinalizeFakeClient([])
    io = object.__new__(SupabaseIO)
    io.client = client

    io.try_finalize_scheduled_refresh_batch(job)

    assert len(client.data_state.upserted) == 0


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


def test_fetch_prices_frame_retries_transient_statement_timeout() -> None:
    rows = [
        {"ticker": "AAA", "date": "2021-01-01", "adj_close": 100.0},
        {"ticker": "AAA", "date": "2021-01-04", "adj_close": 101.0},
    ]
    table = _RetryablePricesTable(rows, failures_remaining=1)
    io = object.__new__(SupabaseIO)
    io.client = _FakePricesClient(table)

    with patch("factorlab_engine.supabase_io.time.sleep", return_value=None):
        frame = io.fetch_prices_frame(["AAA"], "2021-01-01", "2021-01-31")

    assert list(frame.columns) == ["AAA"]
    assert len(frame) == 2
    assert table.execute_calls >= 2


def test_update_run_metadata_retries_transient_statement_timeout() -> None:
    runs_table = _RunsTable(failures_remaining=1)
    io = object.__new__(SupabaseIO)
    io.client = _FakeRunsClient(runs_table)

    with patch("factorlab_engine.supabase_io.time.sleep", return_value=None):
        io.update_run_metadata("run-1", {"model_impl": "ridge"})

    assert runs_table.update_payloads == [{"run_metadata": {"model_impl": "ridge"}}]
