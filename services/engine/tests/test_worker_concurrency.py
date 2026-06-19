from __future__ import annotations

from typing import Any, Callable

from factorlab_engine.supabase_io import Job
from factorlab_engine.worker.claiming import (
    _partition_jobs_for_concurrency,
    _process_backtest_jobs_concurrently,
    _resolve_backtest_concurrency,
)


def test_resolve_backtest_concurrency_defaults_to_one(monkeypatch) -> None:
    monkeypatch.delenv("BACKTEST_WORKER_CONCURRENCY", raising=False)

    assert _resolve_backtest_concurrency() == 1


def test_resolve_backtest_concurrency_clamps_invalid_values(monkeypatch) -> None:
    monkeypatch.setenv("BACKTEST_WORKER_CONCURRENCY", "0")
    assert _resolve_backtest_concurrency() == 1

    monkeypatch.setenv("BACKTEST_WORKER_CONCURRENCY", "not-a-number")
    assert _resolve_backtest_concurrency() == 1

    monkeypatch.setenv("BACKTEST_WORKER_CONCURRENCY", "99")
    assert _resolve_backtest_concurrency() == 8


def test_partition_jobs_keeps_only_backtests_in_concurrent_bucket() -> None:
    backtest = Job(id="job-backtest", run_id="run-1", name="Backtest")
    legacy_ingest = Job(
        id="job-ingest",
        run_id=None,
        name="Ingest",
        job_type="data_ingest",
        payload={"ticker": "SPY"},
    )

    concurrent_jobs, sequential_jobs = _partition_jobs_for_concurrency([backtest, legacy_ingest])

    assert concurrent_jobs == [backtest]
    assert sequential_jobs == [legacy_ingest]


def test_process_backtest_jobs_concurrently_uses_fresh_runner_per_job() -> None:
    jobs = [
        Job(id="job-1", run_id="run-1", name="One"),
        Job(id="job-2", run_id="run-2", name="Two"),
    ]
    submitted: list[Job] = []

    class _Future:
        def __init__(self, result: str) -> None:
            self._result = result

        def result(self) -> str:
            return self._result

    class _Executor:
        def __init__(self, *, max_workers: int, mp_context: Any) -> None:
            self.max_workers = max_workers
            self.mp_context = mp_context

        def __enter__(self) -> "_Executor":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def submit(self, runner: Callable[[Job], str], job: Job) -> _Future:
            submitted.append(job)
            return _Future(runner(job))

    def runner(job: Job) -> str:
        return f"processed:{job.id}"

    processed = _process_backtest_jobs_concurrently(
        jobs,
        max_workers=4,
        runner=runner,
        executor_cls=_Executor,
        as_completed_fn=lambda futures: futures,
        mp_context_factory=lambda _method: "spawn-context",
    )

    assert submitted == jobs
    assert processed == 2
