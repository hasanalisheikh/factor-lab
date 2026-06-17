from __future__ import annotations

import os
import platform
import signal
import time
import traceback

import pandas as pd

from factorlab_engine.supabase_io import Job, SupabaseIO

from .execution import _run_backtest
from .http_server import _start_trigger_server, _wakeup
from .ingest_legacy import _process_data_ingest_job
from .ingest_repair import _process_data_ingest_job_v2
from .progress import _build_run_metadata, _Heartbeat, _validate_backtest_result
from .settings import (
    _PERSIST_TIMEOUT_SECONDS,
    MIN_SPAN_DAYS,
    _job_timeout_seconds_for_strategy,
    _utcnow,
    resolve_and_snapshot_universe_symbols,
)


def _install_job_timeout(seconds: int) -> None:
    """Install a SIGALRM-based wall-clock timeout for the current process (POSIX only)."""
    if platform.system() == "Windows":
        return

    def _handler(signum: int, frame: object) -> None:
        raise RuntimeError(
            f"Job exceeded maximum runtime of {seconds}s ({seconds // 60} min). "
            "The backtest or model training took too long and was aborted. "
            "Try a shorter date range or a lighter-weight strategy."
        )

    signal.signal(signal.SIGALRM, _handler)
    signal.alarm(seconds)


def _cancel_job_timeout() -> None:
    """Cancel any pending SIGALRM timeout."""
    if platform.system() == "Windows":
        return
    signal.alarm(0)


def _process_job(io: SupabaseIO, job: Job) -> None:
    if not io.claim_job(job):
        return

    if job.job_type == "data_ingest":
        _process_data_ingest_job(io, job)
        # Chain to backtest if this was the last preflight ingest job for a waiting run
        io.try_chain_preflight_backtest(job)
        return

    started = _utcnow()
    run = io.fetch_run(job.run_id)  # type: ignore[arg-type]
    if run is None:
        raise RuntimeError(f"Run not found for run_id={job.run_id}")
    job_timeout_seconds = _job_timeout_seconds_for_strategy(str(run.get("strategy_id", "")))
    print(
        f"[engine] phase=start job={job.id} run={job.run_id} "
        f"compute_budget={job_timeout_seconds}s persist_budget={_PERSIST_TIMEOUT_SECONDS}s"
    )
    _install_job_timeout(job_timeout_seconds)
    try:
        # _Heartbeat ticks updated_at + heartbeat_at every 10 s for the entire job
        # lifetime (compute AND persist).  The stall watchdog uses heartbeat_at as the
        # primary liveness signal, so long ML training phases no longer trigger false
        # stall-detection even when progress_cb hasn't been called recently.
        with _Heartbeat(lambda: io.heartbeat_job(job.id), interval=10, job_id=job.id):
            io.update_job_progress(job.id, stage="ingest", progress=10)
            resolve_and_snapshot_universe_symbols(io, run)

            # Early span validation — fast-fail before any data fetch or computation.
            try:
                start_dt = pd.to_datetime(run["start_date"])
                end_dt = pd.to_datetime(run["end_date"])
                requested_span = (end_dt - start_dt).days
            except Exception:
                requested_span = 0
            if requested_span < MIN_SPAN_DAYS:
                raise ValueError(
                    f"Requested date range is too short: {requested_span} days "
                    f"({requested_span / 365:.1f} years). "
                    f"A robust backtest requires at least {MIN_SPAN_DAYS} days (2 years). "
                    "Please choose an earlier start date."
                )

            # Progress callback: updates job stage/progress via DB during computation.
            def progress_cb(stage: str, pct: int) -> None:
                io.update_job_progress(job.id, stage=stage, progress=pct)

            result = _run_backtest(io, run, progress_cb)

            assert job.run_id is not None

            # Validate all required outputs are present before marking as completed.
            _validate_backtest_result(result, job.run_id)

            progress_cb("persist", 82)
            io.update_run_metadata(job.run_id, _build_run_metadata(run, result))
            progress_cb("persist", 88)

            # Computation is done. Cancel the compute SIGALRM and install a separate
            # persistence budget so DB writes are bounded independently of the backtest
            # runtime. The heartbeat thread stays alive through this phase so the stall
            # watchdog can still detect a truly hung persist operation.
            _cancel_job_timeout()
            _install_job_timeout(_PERSIST_TIMEOUT_SECONDS)
            print(
                f"[engine] phase=persist_start job={job.id} "
                f"elapsed={int((_utcnow() - started).total_seconds())}s"
            )

            duration = int((_utcnow() - started).total_seconds())
            io.save_success(
                job=job,
                duration_seconds=duration,
                metrics=result.metrics,
                equity_rows=({"run_id": job.run_id, **row} for row in result.equity_rows),
                feature_rows=result.feature_rows,
                prediction_rows=result.prediction_rows,
                model_metadata=result.model_metadata,
                position_rows=result.position_rows,
            )
            # Persist budget consumed — cancel before the heartbeat context exits.
            _cancel_job_timeout()
            print(f"[engine] phase=completed job={job.id} in {duration}s")
    except Exception as exc:
        _cancel_job_timeout()
        duration = int((_utcnow() - started).total_seconds())
        err_str = str(exc)
        # Print first — so the error is always visible in logs even if the DB write fails.
        print(f"[engine] phase=failed job={job.id} in {duration}s: {err_str}")
        try:
            io.save_failure(job, duration, err_str)
        except Exception as save_exc:
            print(f"[engine] CRITICAL: could not persist failure for job={job.id}: {save_exc}")


def main() -> None:
    once = os.getenv("RUN_ONCE", "").lower() in ("1", "true", "yes")
    poll_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
    batch_size = int(os.getenv("JOB_BATCH_SIZE", "3"))
    port = int(os.getenv("PORT", "8000"))
    job_stall_minutes = int(os.getenv("JOB_STALL_MINUTES", "15"))
    job_queue_timeout_minutes = int(os.getenv("JOB_QUEUED_TIMEOUT_MINUTES", "10"))

    if not once:
        _start_trigger_server(port)

    io = SupabaseIO()
    print("[engine] worker started")
    while True:
        try:
            # --- Watchdog & retry scheduler (run before fetching new work) ---
            # jobs table (backtest + legacy data_ingest jobs)
            io.scan_and_requeue_stalled_jobs(stall_minutes=job_stall_minutes, max_attempts=5)
            io.scan_and_requeue_queued_too_long(
                timeout_minutes=job_queue_timeout_minutes, max_attempts=5
            )
            io.requeue_due_for_retry(max_attempts=5)
            # data_ingest_jobs table (new explicit-schema ingest jobs)
            io.scan_stalled_data_ingest_jobs(stall_minutes=2, max_attempts=5)
            io.scan_queued_too_long_data_ingest(timeout_minutes=10, max_attempts=5)
            io.requeue_due_data_ingest(max_attempts=5)

            # Fetch from both queues and process
            jobs = io.fetch_queued_jobs(limit=batch_size)
            ingest_jobs = io.fetch_queued_data_ingest_jobs(limit=batch_size)
            print(
                f"[engine] poll queued_backtest={len(jobs)} "
                f"queued_ingest={len(ingest_jobs)} batch_size={batch_size}"
            )

            if not jobs and not ingest_jobs:
                if once:
                    print("[engine] no more queued jobs — exiting")
                    break
                _wakeup.wait(timeout=poll_seconds)
                _wakeup.clear()
                continue

            _wakeup.clear()
            for job in jobs:
                _process_job(io, job)
            for ingest_job in ingest_jobs:
                if io.claim_data_ingest_job(ingest_job):
                    _process_data_ingest_job_v2(io, ingest_job)
        except (SystemExit, KeyboardInterrupt):
            raise
        except Exception as exc:
            # An unhandled error in watchdog scans or queue fetches must not crash the
            # long-running Render service. Log, sleep, and retry so the worker stays alive.
            print(f"[engine] CRITICAL: main loop error, sleeping 30s before retry: {exc}")
            traceback.print_exc()
            time.sleep(30)


if __name__ == "__main__":
    main()
