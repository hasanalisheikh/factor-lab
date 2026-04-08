from __future__ import annotations

import os
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

import pandas as pd
from supabase import Client, create_client

# Maximum wall-clock runtime for a data_ingest_job before it is considered hung.
# A job that heartbeats normally (updated_at stays fresh) but blocks indefinitely
# in yfinance will be caught by this secondary check even though the 2-minute
# heartbeat stall scanner won't trigger.
_INGEST_MAX_RUNTIME_SECONDS: int = int(os.getenv("INGEST_MAX_RUNTIME_SECONDS", "300"))  # 5 min

# Benchmark tickers that MUST succeed for a refresh batch to be finalized.
# Non-benchmark tickers (SP100 / NASDAQ100 constituents) may be blocked or failed
# without preventing data_state from advancing — a single delisted stock should
# not freeze the entire pipeline indefinitely.
_BENCHMARK_TICKERS: frozenset[str] = frozenset(
    ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]
)
_TRANSIENT_DB_RETRY_ATTEMPTS: int = int(os.getenv("SUPABASE_TRANSIENT_RETRY_ATTEMPTS", "3"))
_TRANSIENT_DB_RETRY_BASE_SECONDS: float = float(
    os.getenv("SUPABASE_TRANSIENT_RETRY_BASE_SECONDS", "0.5")
)
_SUPABASE_SELECT_PAGE_SIZE = 1000

# Identifies this worker process in jobs.worker_id for debugging.
_WORKER_ID: str = f"{socket.gethostname()}:{os.getpid()}"


@dataclass(frozen=True)
class Job:
    id: str
    run_id: str | None  # None for data_ingest jobs
    name: str
    stage: str | None = None
    job_type: str = "backtest"
    payload: dict | None = None
    preflight_run_id: str | None = None  # Links a data_ingest job to its waiting run
    attempt_count: int = 0  # Number of times this job has been attempted


@dataclass(frozen=True)
class DataIngestJob:
    """Represents a row in the data_ingest_jobs table (explicit schema, no JSONB payload)."""

    id: str
    symbol: str
    start_date: str
    end_date: str
    stage: str | None = None
    attempt_count: int = 0
    request_mode: str | None = None
    batch_id: str | None = None
    target_cutoff_date: str | None = None
    requested_by: str | None = None
    requested_by_run_id: str | None = None
    requested_by_user_id: str | None = None


# Exponential back-off delays (seconds) indexed by attempt number.
# attempt 1 → 60 s, 2 → 300 s, 3 → 900 s, 4+ → 3600 s
_RETRY_DELAYS_SECONDS: list[int] = [60, 300, 900, 3600]


def _get_retry_delay(attempt_count: int) -> int:
    """Return the retry delay in seconds for the given attempt number."""
    idx = min(max(attempt_count - 1, 0), len(_RETRY_DELAYS_SECONDS) - 1)
    return _RETRY_DELAYS_SECONDS[idx]


def _get_data_ingest_max_attempts(request_mode: str | None) -> int:
    """Return the maximum attempts for a data_ingest job, including the first run."""
    return 3 if (request_mode or "").lower() == "daily" else 5


class SupabaseIO:
    def __init__(self) -> None:
        url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        self.client: Client = create_client(url, key)
        self._legacy_data_ingest_schema: bool | None = None
        self._notifications_available: bool | None = None

    def _is_missing_data_ingest_column_error(self, exc: Exception | str) -> bool:
        message = str(exc).lower()
        return (
            ("data_ingest_jobs" in message or "schema cache" in message)
            and ("does not exist" in message or "could not find" in message)
            and any(
                column in message
                for column in (
                    "request_mode",
                    "batch_id",
                    "target_cutoff_date",
                    "requested_by",
                    "last_heartbeat_at",
                    "rows_inserted",
                    "deferred_to_monthly",
                )
            )
        )

    def _is_transient_db_timeout(self, exc: Exception | str) -> bool:
        message = str(exc).lower()
        return (
            "statement timeout" in message
            or "canceling statement due to statement timeout" in message
            or "code': '57014'" in message
            or 'code": "57014"' in message
            or '"code":"57014"' in message
        )

    def _execute_with_retry(
        self,
        action: Callable[[], Any],
        *,
        context: str,
        attempts: int | None = None,
    ) -> Any:
        max_attempts = max(1, attempts or _TRANSIENT_DB_RETRY_ATTEMPTS)
        last_exc: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                return action()
            except Exception as exc:
                last_exc = exc
                if attempt >= max_attempts or not self._is_transient_db_timeout(exc):
                    raise
                delay = _TRANSIENT_DB_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
                print(
                    f"[supabase_io] transient DB timeout during {context}; "
                    f"retry {attempt}/{max_attempts} in {delay:.2f}s"
                )
                time.sleep(delay)

        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"{context} failed without raising an exception")

    def _normalize_data_ingest_status(self, status: str | None) -> str | None:
        if status == "completed":
            return "succeeded"
        return status

    def _legacy_data_ingest_mode(self) -> bool | None:
        return getattr(self, "_legacy_data_ingest_schema", None)

    def _is_missing_notifications_error(self, exc: Exception | str) -> bool:
        message = str(exc).lower()
        return "notifications" in message and (
            "does not exist" in message or "schema cache" in message or "could not find" in message
        )

    def _build_job_notification(
        self,
        *,
        status: str,
        name: str,
        error_message: str | None = None,
    ) -> dict[str, str]:
        if status == "completed":
            return {
                "title": f"Run completed: {name}",
                "body": "Your run finished successfully.",
                "level": "success",
            }
        if status == "failed":
            return {
                "title": f"Run failed: {name}",
                "body": error_message
                or "Your run failed. Open the job details for more information.",
                "level": "error",
            }
        if status == "blocked":
            return {
                "title": f"Run blocked: {name}",
                "body": error_message
                or "Your run was blocked. Open the job details for more information.",
                "level": "warning",
            }
        if status == "running":
            return {
                "title": f"Job running: {name}",
                "body": "Your run is now processing.",
                "level": "info",
            }
        return {
            "title": f"Job queued: {name}",
            "body": "Your run is queued and will start soon.",
            "level": "info",
        }

    def _get_run_owner_id(self, run_id: str) -> str | None:
        try:
            result = self.client.table("runs").select("user_id").eq("id", run_id).execute()
        except Exception as exc:
            print(f"[supabase_io] run owner lookup warning run={run_id}: {exc}")
            return None

        rows = result.data or []
        if not rows:
            return None

        user_id = rows[0].get("user_id")
        return str(user_id) if user_id else None

    def _upsert_job_notification(
        self,
        *,
        job_id: str,
        run_id: str,
        user_id: str | None,
        name: str,
        status: str,
        error_message: str | None = None,
    ) -> None:
        if not user_id or self._notifications_available is False:
            return

        payload = self._build_job_notification(
            status=status, name=name, error_message=error_message
        )
        now = datetime.now(timezone.utc).isoformat()

        try:
            existing = (
                self.client.table("notifications").select("id").eq("job_id", job_id).execute()
            )
            rows = existing.data or []

            values = {
                "user_id": user_id,
                "run_id": run_id,
                "job_id": job_id,
                "title": payload["title"],
                "body": payload["body"],
                "level": payload["level"],
                "read_at": None,
                "created_at": now,
            }

            if rows and rows[0].get("id"):
                (
                    self.client.table("notifications")
                    .update(values)
                    .eq("id", rows[0]["id"])
                    .execute()
                )
            else:
                self.client.table("notifications").insert(values).execute()

            self._notifications_available = True
        except Exception as exc:
            if self._is_missing_notifications_error(exc):
                if self._notifications_available is not False:
                    print(f"[supabase_io] notifications unavailable; skipping writes: {exc}")
                self._notifications_available = False
                return
            print(f"[supabase_io] notification write warning job={job_id}: {exc}")

    def _sync_backtest_notification(
        self,
        job: Job,
        *,
        status: str,
        error_message: str | None = None,
    ) -> None:
        if not job.run_id:
            return

        user_id = self._get_run_owner_id(job.run_id)
        self._upsert_job_notification(
            job_id=job.id,
            run_id=job.run_id,
            user_id=user_id,
            name=job.name,
            status=status,
            error_message=error_message,
        )

    def _legacy_data_ingest_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        compat = dict(payload)
        for column in (
            "request_mode",
            "batch_id",
            "target_cutoff_date",
            "requested_by",
            "last_heartbeat_at",
            "rows_inserted",
            "deferred_to_monthly",
        ):
            compat.pop(column, None)
        if compat.get("status") == "succeeded":
            compat["status"] = "completed"
        elif compat.get("status") == "retrying":
            compat["status"] = "failed"
        if compat.get("stage") == "upsert_prices":
            compat["stage"] = "upsert"
        return compat

    def _should_retry_legacy_data_ingest_write(
        self,
        message: str,
        payload: dict[str, Any],
    ) -> bool:
        lower = message.lower()
        return (
            self._is_missing_data_ingest_column_error(lower)
            or (
                payload.get("status") in ("succeeded", "retrying")
                and "data_ingest_jobs_status_check" in lower
            )
            or (
                payload.get("stage") == "upsert_prices"
                and "stage" in lower
                and "data_ingest_jobs" in lower
            )
        )

    def _select_data_ingest_rows(
        self,
        extended_fields: str,
        legacy_fields: str,
        query_builder: Any,
    ) -> Any:
        if self._legacy_data_ingest_mode() is True:
            return query_builder(legacy_fields).execute()
        try:
            return query_builder(extended_fields).execute()
        except Exception as exc:
            if not self._is_missing_data_ingest_column_error(exc):
                raise
            self._legacy_data_ingest_schema = True
            return query_builder(legacy_fields).execute()

    def _update_data_ingest_row(self, job_id: str, values: dict[str, Any]) -> Any:
        payload = dict(values)
        for _ in range(2):
            write_payload = (
                self._legacy_data_ingest_payload(payload)
                if self._legacy_data_ingest_mode()
                else dict(payload)
            )
            try:
                return (
                    self.client.table("data_ingest_jobs")
                    .update(write_payload)
                    .eq("id", job_id)
                    .execute()
                )
            except Exception as exc:
                if self._legacy_data_ingest_mode():
                    raise
                if not self._should_retry_legacy_data_ingest_write(str(exc), payload):
                    raise
                self._legacy_data_ingest_schema = True
        raise RuntimeError(f"data_ingest_jobs update failed for {job_id}")

    def fetch_queued_jobs(self, limit: int = 3) -> list[Job]:
        result = (
            self.client.table("jobs")
            .select("id,run_id,name,stage,job_type,payload,preflight_run_id,attempt_count")
            .eq("status", "queued")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        rows = result.data or []
        jobs: list[Job] = []
        for row in rows:
            job_type = row.get("job_type", "backtest")
            run_id = row.get("run_id")
            # Backtest jobs must have a run_id; skip orphaned rows
            if job_type == "backtest" and not run_id:
                continue
            jobs.append(
                Job(
                    id=row["id"],
                    run_id=run_id,
                    name=row["name"],
                    stage=row.get("stage"),
                    job_type=job_type,
                    payload=row.get("payload"),
                    preflight_run_id=row.get("preflight_run_id"),
                    attempt_count=int(row.get("attempt_count") or 0),
                )
            )
        return jobs

    def claim_job(self, job: Job) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        claim_payload = {
            "status": "running",
            "stage": "ingest",
            "progress": 5,
            "started_at": now,
            "updated_at": now,
            "locked_at": now,
            # claimed_at: set once at claim time, never updated — queue-age analytics.
            "claimed_at": now,
            # worker_id: hostname:pid for correlating logs across workers.
            "worker_id": _WORKER_ID,
            # heartbeat_at: starts NULL; populated by first heartbeat tick (≤10 s).
            # Stall detection uses this column as the primary liveness signal.
            "heartbeat_at": None,
            "finished_at": None,
            "error_message": None,
            "next_retry_at": None,
        }
        try:
            claimed = (
                self.client.table("jobs")
                .update(claim_payload)
                .eq("id", job.id)
                .eq("status", "queued")
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            # Backward compat: strip columns that don't exist on older schemas yet.
            # The three new columns (claimed_at, worker_id, heartbeat_at) were all
            # added in the same migration — strip all three if any one is missing so
            # the single retry doesn't hit a second PGRST204 error.
            retried = False
            new_migration_cols = ("claimed_at", "worker_id", "heartbeat_at")
            if any(col in message for col in new_migration_cols):
                for col in new_migration_cols:
                    claim_payload.pop(col, None)
                retried = True
            for col in ("finished_at", "updated_at", "locked_at", "next_retry_at"):
                if col in claim_payload and col in message:
                    claim_payload.pop(col, None)
                    retried = True
            if not retried:
                raise
            claimed = (
                self.client.table("jobs")
                .update(claim_payload)
                .eq("id", job.id)
                .eq("status", "queued")
                .execute()
            )
        if not (claimed.data or []):
            return False

        print(f"[supabase_io] claimed backtest job={job.id} run={job.run_id} worker={_WORKER_ID}")

        # Only update run status for backtest jobs that have a run_id
        if job.run_id:
            (
                self.client.table("runs")
                .update({"status": "running"})
                .eq("id", job.run_id)
                .eq("status", "queued")
                .execute()
            )
            self._sync_backtest_notification(job, status="running")
        return True

    def fetch_run(self, run_id: str) -> dict[str, Any] | None:
        result = (
            self.client.table("runs")
            .select(
                "id,name,strategy_id,status,start_date,end_date,benchmark,benchmark_ticker,costs_bps,top_n,universe,universe_symbols,run_params,run_metadata"
            )
            .eq("id", run_id)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def update_run_universe_symbols(self, run_id: str, symbols: list[str]) -> None:
        (self.client.table("runs").update({"universe_symbols": symbols}).eq("id", run_id).execute())

    def update_run_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:
        self._execute_with_retry(
            lambda: (
                self.client.table("runs")
                .update({"run_metadata": metadata})
                .eq("id", run_id)
                .execute()
            ),
            context=f"update_run_metadata run_id={run_id}",
        )

    def _update_job_row(
        self,
        job_id: str,
        values: dict[str, Any],
        *,
        fallback_stage: str | None = None,
    ) -> Any:
        """Update a jobs row with light backward-compat fallbacks.

        Handles three migration-drift cases:
        - `finished_at` column not present yet.
        - `updated_at` column not present yet (pre-20260312 migration).
        - data-ingest custom stage not allowed by legacy jobs_stage_check.

        Also injects updated_at=NOW() on every write so progress updates
        double as heartbeats — no callers need to set it explicitly.
        """
        payload = dict(values)
        # Inject heartbeat timestamp on every job write.
        if "updated_at" not in payload:
            payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        for _ in range(3):
            try:
                return self.client.table("jobs").update(payload).eq("id", job_id).execute()
            except Exception as exc:
                message = str(exc).lower()
                retried = False
                if "finished_at" in payload and "finished_at" in message:
                    payload.pop("finished_at", None)
                    retried = True
                if "updated_at" in payload and "updated_at" in message:
                    payload.pop("updated_at", None)
                    retried = True
                # Backward compat: new columns added by 20260313 migration
                for col in ("next_retry_at", "locked_at"):
                    if col in payload and col in message:
                        payload.pop(col, None)
                        retried = True
                if fallback_stage and "stage" in payload and "stage" in message:
                    if payload.get("stage") != fallback_stage:
                        payload["stage"] = fallback_stage
                        retried = True
                if not retried:
                    raise
        raise RuntimeError("jobs update failed after fallback retries")

    def update_job_progress(self, job_id: str, *, stage: str, progress: int) -> None:
        bounded = max(0, min(int(progress), 100))
        # Map newer stage names to a fallback that older DB schemas will accept.
        # Fallback is used when the jobs_stage_check constraint rejects the value
        # (i.e., the 20260307_jobs_stage_backtest_detail.sql migration hasn't run yet).
        _data_ingest_stages = {"download", "transform", "upsert_prices"}
        _early_backtest_stages = {"load_data"}
        _mid_backtest_stages = {"compute_signals", "rebalance", "metrics"}
        _late_backtest_stages = {"persist"}
        if stage in _data_ingest_stages:
            fallback_stage = "ingest"
        elif stage in _early_backtest_stages:
            fallback_stage = "ingest"
        elif stage in _mid_backtest_stages:
            fallback_stage = "backtest"
        elif stage in _late_backtest_stages:
            fallback_stage = "report"
        else:
            fallback_stage = "report"
        self._update_job_row(
            job_id,
            {"stage": stage, "progress": bounded},
            fallback_stage=fallback_stage,
        )

    def heartbeat_job(self, job_id: str) -> None:
        """Write heartbeat_at=NOW() and updated_at=NOW() to signal the job is alive.

        Called by the _Heartbeat background thread every 10 seconds.
        - heartbeat_at: dedicated liveness column, written ONLY by this function.
          Stall detection uses it as the primary signal so progress updates
          (which also touch updated_at) never mask a silent worker.
        - updated_at: general mutation timestamp, retained as fallback for stall
          detection on schemas that pre-date the heartbeat_at column.
        Does NOT update locked_at or claimed_at — those stay frozen as analytics
        timestamps (claim time) distinct from liveness.
        Silently ignores all errors — a failed heartbeat must never kill an
        in-progress job.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            self.client.table("jobs").update({"updated_at": now, "heartbeat_at": now}).eq(
                "id", job_id
            ).execute()
        except Exception as exc:
            # heartbeat_at column may not exist on old schemas — retry with updated_at only.
            if "heartbeat_at" in str(exc).lower():
                try:
                    now = datetime.now(timezone.utc).isoformat()
                    self.client.table("jobs").update({"updated_at": now}).eq("id", job_id).execute()
                except Exception as exc2:
                    print(f"[supabase_io] heartbeat warning job={job_id}: {exc2}")
            else:
                print(f"[supabase_io] heartbeat warning job={job_id}: {exc}")

    def scan_and_requeue_stalled_jobs(
        self,
        stall_minutes: int = 2,
        max_attempts: int = 5,
    ) -> None:
        """Detect running jobs whose heartbeat has gone silent and schedule a retry.

        Called once per worker main-loop iteration. Silently handles all errors
        so a buggy scan never crashes the worker.

        Logic:
          - Find jobs WHERE status='running' AND updated_at < NOW() - stall_minutes
          - If attempt_count + 1 < max_attempts: mark failed with next_retry_at (backoff)
          - If at/past max_attempts: fail permanently (no next_retry_at)
          - Only propagate failure to a waiting run when permanently failed
            (failed jobs with next_retry_at are still in-flight from the run's perspective)
        """
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=stall_minutes)).isoformat()

            # Primary: use heartbeat_at (written only by the heartbeat thread — no
            # false-negatives from progress writes). Fallback: jobs whose heartbeat_at
            # is still NULL (claimed but not yet ticked) use updated_at instead.
            # The or_() filter handles both cases in one query.
            try:
                result = (
                    self.client.table("jobs")
                    .select("id, stage, attempt_count, preflight_run_id, payload, job_type")
                    .eq("status", "running")
                    .or_(
                        f"heartbeat_at.lt.{cutoff},and(heartbeat_at.is.null,updated_at.lt.{cutoff})"
                    )
                    .execute()
                )
            except Exception:
                # heartbeat_at column not yet present — fall back to updated_at only.
                result = (
                    self.client.table("jobs")
                    .select("id, stage, attempt_count, preflight_run_id, payload, job_type")
                    .eq("status", "running")
                    .lt("updated_at", cutoff)
                    .execute()
                )
            stalled = result.data or []
            if not stalled:
                return

            print(f"[supabase_io] scan found {len(stalled)} stalled job(s)")
            now_iso = datetime.now(timezone.utc).isoformat()

            for row in stalled:
                job_id = row["id"]
                attempt = int(row.get("attempt_count") or 0)
                next_attempt = attempt + 1

                if next_attempt < max_attempts:
                    # Schedule a retry with exponential back-off
                    delay = _get_retry_delay(next_attempt)
                    next_retry_at = (
                        datetime.now(timezone.utc) + timedelta(seconds=delay)
                    ).isoformat()
                    self.client.table("jobs").update(
                        {
                            "status": "failed",
                            "stage": row.get("stage") or "finalize",
                            "attempt_count": next_attempt,
                            "next_retry_at": next_retry_at,
                            "updated_at": now_iso,
                            "error_message": (
                                f"[stalled] no heartbeat for {stall_minutes}m "
                                f"(attempt {next_attempt}/{max_attempts}). "
                                f"Retry scheduled in {delay}s."
                            ),
                        }
                    ).eq("id", job_id).execute()
                    print(
                        f"[supabase_io] stalled job={job_id} attempt={next_attempt} "
                        f"retry_at={next_retry_at} (no heartbeat for {stall_minutes}m)"
                    )
                    # Do NOT call try_chain_preflight_backtest — job will be retried.
                else:
                    # Max attempts exhausted — permanently failed
                    error_msg = (
                        f"[stalled] no heartbeat for {stall_minutes}m after "
                        f"{next_attempt} attempt(s). Worker likely crashed mid-job."
                    )
                    self.client.table("jobs").update(
                        {
                            "status": "failed",
                            "stage": row.get("stage") or "finalize",
                            "progress": 100,
                            "attempt_count": next_attempt,
                            "finished_at": now_iso,
                            "updated_at": now_iso,
                            "next_retry_at": None,
                            "error_message": error_msg[:2000],
                        }
                    ).eq("id", job_id).execute()
                    print(
                        f"[supabase_io] permanently failed stalled job={job_id} "
                        f"(exhausted {next_attempt} attempts)"
                    )

                    # Propagate failure to any waiting run linked via preflight_run_id
                    preflight_run_id = row.get("preflight_run_id")
                    if preflight_run_id:
                        fake_job = Job(
                            id=job_id,
                            run_id=None,
                            name="stalled",
                            job_type=row.get("job_type", "data_ingest"),
                            payload=row.get("payload"),
                            preflight_run_id=preflight_run_id,
                        )
                        self.try_chain_preflight_backtest(fake_job)

        except Exception as exc:
            print(f"[supabase_io] scan_and_requeue_stalled_jobs error: {exc}")

    def scan_and_requeue_queued_too_long(
        self,
        timeout_minutes: int = 10,
        max_attempts: int = 5,
    ) -> None:
        """Detect data_ingest jobs stuck in queued state (worker unavailable).

        Called once per worker main-loop iteration. Silently handles all errors.

        Logic:
          - Find data_ingest jobs WHERE status='queued' AND created_at < NOW() - timeout_minutes
          - If attempt_count < max_attempts: mark failed with a short next_retry_at (30 s)
            so the retry scheduler re-queues them quickly once a worker is running
          - If at/past max_attempts: fail permanently and propagate to waiting run
        """
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)).isoformat()

            result = (
                self.client.table("jobs")
                .select("id, stage, attempt_count, preflight_run_id, payload, job_type")
                .eq("status", "queued")
                .eq("job_type", "data_ingest")
                .lt("created_at", cutoff)
                .execute()
            )
            stuck = result.data or []
            if not stuck:
                return

            print(f"[supabase_io] scan found {len(stuck)} queued-too-long job(s)")
            now_iso = datetime.now(timezone.utc).isoformat()

            for row in stuck:
                job_id = row["id"]
                attempt = int(row.get("attempt_count") or 0)
                next_attempt = attempt + 1

                if next_attempt < max_attempts:
                    # Mark failed with a short retry (30 s) — worker will requeue ASAP
                    next_retry_at = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
                    self.client.table("jobs").update(
                        {
                            "status": "failed",
                            "attempt_count": next_attempt,
                            "next_retry_at": next_retry_at,
                            "updated_at": now_iso,
                            "error_message": (
                                f"[queued-too-long] queued for >{timeout_minutes}m without being claimed. "
                                f"Worker may not be running. Retry scheduled in 30s."
                            ),
                        }
                    ).eq("id", job_id).execute()
                    print(
                        f"[supabase_io] queued-too-long job={job_id} attempt={next_attempt} "
                        f"retry_at={next_retry_at}"
                    )
                else:
                    # Permanently failed
                    error_msg = (
                        f"[queued-too-long] queued for >{timeout_minutes}m after "
                        f"{next_attempt} attempt(s). No worker available."
                    )
                    self.client.table("jobs").update(
                        {
                            "status": "failed",
                            "progress": 100,
                            "attempt_count": next_attempt,
                            "finished_at": now_iso,
                            "updated_at": now_iso,
                            "next_retry_at": None,
                            "error_message": error_msg[:2000],
                        }
                    ).eq("id", job_id).execute()
                    print(
                        f"[supabase_io] permanently failed queued-too-long job={job_id} "
                        f"(exhausted {next_attempt} attempts)"
                    )

                    preflight_run_id = row.get("preflight_run_id")
                    if preflight_run_id:
                        fake_job = Job(
                            id=job_id,
                            run_id=None,
                            name="queued-too-long",
                            job_type=row.get("job_type", "data_ingest"),
                            payload=row.get("payload"),
                            preflight_run_id=preflight_run_id,
                        )
                        self.try_chain_preflight_backtest(fake_job)

        except Exception as exc:
            print(f"[supabase_io] scan_and_requeue_queued_too_long error: {exc}")

    def requeue_due_for_retry(self, max_attempts: int = 5) -> None:
        """Re-queue failed data_ingest jobs whose next_retry_at has arrived.

        This is the retry scheduler — it runs every worker main-loop iteration
        and moves jobs from status='failed' (with next_retry_at <= NOW()) back
        to status='queued' so the worker picks them up.

        Legacy rows in `jobs` require a non-null stage, so requeued jobs reset to
        the initial "ingest" stage instead of NULL.
        """
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            result = (
                self.client.table("jobs")
                .select("id, attempt_count")
                .eq("status", "failed")
                .eq("job_type", "data_ingest")
                .lte("next_retry_at", now_iso)
                .lt("attempt_count", max_attempts)
                .not_.is_("next_retry_at", "null")
                .execute()
            )
            due = result.data or []
            if not due:
                return

            print(f"[supabase_io] requeueing {len(due)} due-for-retry job(s)")
            for row in due:
                self.client.table("jobs").update(
                    {
                        "status": "queued",
                        "stage": "ingest",
                        "progress": 0,
                        "next_retry_at": None,
                        "error_message": None,
                        "updated_at": now_iso,
                    }
                ).eq("id", row["id"]).execute()
                print(
                    f"[supabase_io] requeued retry job={row['id']} "
                    f"attempt_count={row['attempt_count']}"
                )
        except Exception as exc:
            print(f"[supabase_io] requeue_due_for_retry error: {exc}")

    def fetch_prices_frame(
        self, tickers: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        if not tickers:
            return pd.DataFrame()

        rows: list[dict[str, Any]] = []
        # Fetch one ticker at a time so every query is a tight single-column
        # index scan on idx_prices_ticker_date with no large OFFSET.  The
        # multi-ticker IN(…)+ORDER BY approach requires Postgres to merge N
        # sorted streams and skip potentially 10 000–20 000 rows on later pages,
        # which reliably hits Supabase's statement timeout for long date windows
        # (ML warmup = 5 years → ~2 500 rows per ticker → 5+ pages multi-ticker).
        page_size = _SUPABASE_SELECT_PAGE_SIZE
        for ticker in tickers:
            offset = 0
            while True:
                result = self._execute_with_retry(
                    lambda: (
                        self.client.table("prices")
                        .select("ticker,date,adj_close")
                        .eq("ticker", ticker)
                        .gte("date", start_date)
                        .lte("date", end_date)
                        .order("date")
                        .range(offset, offset + page_size - 1)
                        .execute()
                    ),
                    context=(
                        f"fetch_prices_frame ticker={ticker} "
                        f"range={start_date}..{end_date} offset={offset}"
                    ),
                )
                chunk = result.data or []
                if not chunk:
                    break
                rows.extend(chunk)
                if len(chunk) < page_size:
                    break
                offset += page_size

        if not rows:
            return pd.DataFrame()

        frame = pd.DataFrame(rows)
        frame["date"] = pd.to_datetime(frame["date"], utc=False)
        pivot = frame.pivot(index="date", columns="ticker", values="adj_close")
        return pivot.sort_index().ffill().dropna(how="all")

    def save_success(
        self,
        job: Job,
        duration_seconds: int,
        metrics: dict[str, float],
        equity_rows: Iterable[dict[str, Any]],
        feature_rows: list[dict[str, Any]] | None = None,
        prediction_rows: list[dict[str, Any]] | None = None,
        model_metadata: dict[str, Any] | None = None,
        position_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        assert job.run_id is not None, "save_success requires a run_id"
        rows = list(equity_rows)
        self._replace_equity_curve(job.run_id, rows)
        self._upsert_metrics(job.run_id, metrics)
        if feature_rows:
            self._upsert_features_monthly(feature_rows)
        if prediction_rows is not None:
            self._replace_model_predictions(job.run_id, prediction_rows)
        if model_metadata is not None:
            self._replace_model_metadata(job.run_id, model_metadata)
        if position_rows is not None:
            self._replace_positions(job.run_id, position_rows)

        # Mark run completed FIRST — this is the UI-visible status badge.
        # Doing this before the job row means that if the job update fails on a
        # transient error, the run is already in the correct terminal state.
        # Both writes are idempotent (same value on retry), so re-running
        # save_success() after a partial failure is safe.
        runs_update: dict[str, Any] = {"status": "completed"}
        if rows:
            dates = [row["date"] for row in rows]
            runs_update["executed_start_date"] = min(dates)
            runs_update["executed_end_date"] = max(dates)
        self._execute_with_retry(
            lambda: self.client.table("runs").update(runs_update).eq("id", job.run_id).execute(),
            context=f"finalize_run_success run_id={job.run_id}",
        )

        # Mark job completed second — also idempotent on retry.
        self._update_job_row(
            job.id,
            {
                "status": "completed",
                "stage": "report",
                "progress": 100,
                "duration": max(duration_seconds, 0),
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error_message": None,
            },
            fallback_stage="report",
        )

        # Notification is best-effort — failure here must not prevent the run from
        # reaching completed state (both rows are already written above).
        try:
            self._sync_backtest_notification(job, status="completed")
        except Exception as exc:
            print(f"[supabase_io] notification warning job={job.id}: {exc}")

    def save_failure(
        self,
        job: Job,
        duration_seconds: int,
        error_message: str,
        *,
        stage: str = "report",
    ) -> None:
        message = error_message[:2000]
        _data_ingest_stages = {"download", "transform", "upsert_prices"}
        _early_backtest_stages = {"load_data"}
        _mid_backtest_stages = {"compute_signals", "rebalance", "metrics"}
        if stage in _data_ingest_stages:
            fallback_stage = "ingest"
        elif stage in _early_backtest_stages:
            fallback_stage = "ingest"
        elif stage in _mid_backtest_stages:
            fallback_stage = "backtest"
        else:
            fallback_stage = "report"
        self._update_job_row(
            job.id,
            {
                "status": "failed",
                "stage": stage,
                "duration": max(duration_seconds, 0),
                "progress": 100,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error_message": message,
            },
            fallback_stage=fallback_stage,
        )
        if job.run_id:
            (self.client.table("runs").update({"status": "failed"}).eq("id", job.run_id).execute())
            self._sync_backtest_notification(job, status="failed", error_message=message)

    def save_data_ingest_success(
        self,
        job: Job,
        duration_seconds: int,
        tickers_updated: int,
        rows_upserted: int,
        start_date: str,
        end_date: str,
    ) -> None:
        """Mark a data_ingest job as completed and write a data_ingestion_log entry."""
        self._update_job_row(
            job.id,
            {
                "status": "completed",
                "stage": "finalize",
                "progress": 100,
                "duration": max(duration_seconds, 0),
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error_message": None,
            },
            fallback_stage="report",
        )
        payload = job.payload or {}
        ticker = payload.get("ticker", "unknown")
        try:
            self.client.table("data_ingestion_log").insert(
                {
                    "status": "success",
                    "tickers_updated": tickers_updated,
                    "rows_upserted": rows_upserted,
                    "note": f"on-demand ingest {ticker} ({start_date} to {end_date})",
                    "source": "yfinance",
                }
            ).execute()
        except Exception as exc:
            print(f"[supabase_io] warning: could not write to data_ingestion_log: {exc}")
        # Update ticker_stats cache so /data page reads fast cached stats instead of
        # running a full GROUP BY over the prices table.
        try:
            self.client.rpc("upsert_ticker_stats", {"p_ticker": ticker}).execute()
        except Exception as exc:
            print(f"[supabase_io] warning: could not upsert ticker_stats for {ticker}: {exc}")

    def save_data_ingest_failure_with_retry(
        self,
        job: Job,
        duration_seconds: int,
        error_message: str,
        *,
        stage: str = "download",
    ) -> None:
        """Mark a data_ingest job as failed and schedule an automatic retry.

        Increments attempt_count and sets next_retry_at based on the backoff schedule.
        Does NOT call try_chain_preflight_backtest — the job will be retried, so the
        linked waiting_for_data run should remain in that state.
        """
        next_attempt = job.attempt_count + 1
        delay = _get_retry_delay(next_attempt)
        next_retry_at = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()
        message = error_message[:2000]
        _data_ingest_stages = {"download", "transform", "upsert_prices"}
        fallback_stage = "ingest" if stage in _data_ingest_stages else "report"
        self._update_job_row(
            job.id,
            {
                "status": "failed",
                "stage": stage,
                "duration": max(duration_seconds, 0),
                "progress": 100,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error_message": message,
                "attempt_count": next_attempt,
                "next_retry_at": next_retry_at,
            },
            fallback_stage=fallback_stage,
        )
        print(
            f"[supabase_io] ingest job={job.id} failed (attempt {next_attempt}), "
            f"retry in {delay}s at {next_retry_at}"
        )

    def save_blocked(
        self,
        job: Job,
        duration_seconds: int,
        error_message: str,
        *,
        stage: str = "download",
    ) -> None:
        """Mark a data_ingest job as permanently blocked (no auto-retry).

        Used for errors that indicate a permanent issue: invalid ticker, delisted
        symbol, or other non-retriable failures. Sets status='blocked' with no
        next_retry_at, then propagates to any linked waiting_for_data run.
        """
        _data_ingest_stages = {"download", "transform", "upsert_prices"}
        fallback_stage = "ingest" if stage in _data_ingest_stages else "report"
        self._update_job_row(
            job.id,
            {
                "status": "blocked",
                "stage": stage,
                "duration": max(duration_seconds, 0),
                "progress": 100,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error_message": f"[blocked] {error_message[:1980]}",
                "next_retry_at": None,
            },
            fallback_stage=fallback_stage,
        )
        print(f"[supabase_io] ingest job={job.id} BLOCKED: {error_message[:200]}")
        if job.run_id:
            self._sync_backtest_notification(job, status="blocked", error_message=error_message)
        self.try_chain_preflight_backtest(job)

    def _replace_equity_curve(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("equity_curve").delete().eq("run_id", run_id).execute(),
            context=f"delete_equity_curve run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("equity_curve").insert(chunk).execute(),
                context=f"insert_equity_curve run_id={run_id} rows={len(chunk)} offset={start}",
            )

    def _upsert_metrics(self, run_id: str, metrics: dict[str, float]) -> None:
        payload = {
            "run_id": run_id,
            "cagr": metrics["cagr"],
            "sharpe": metrics["sharpe"],
            "max_drawdown": metrics["max_drawdown"],
            "turnover": metrics["turnover"],
            "volatility": metrics["volatility"],
            "win_rate": metrics["win_rate"],
            "profit_factor": metrics["profit_factor"],
            "calmar": metrics["calmar"],
        }
        self._execute_with_retry(
            lambda: (
                self.client.table("run_metrics").upsert(payload, on_conflict="run_id").execute()
            ),
            context=f"upsert_run_metrics run_id={run_id}",
        )

    def _upsert_features_monthly(self, rows: list[dict[str, Any]], chunk_size: int = 500) -> None:
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: (
                    self.client.table("features_monthly")
                    .upsert(
                        chunk,
                        on_conflict="ticker,date",
                    )
                    .execute()
                ),
                context=f"upsert_features_monthly rows={len(chunk)} offset={start}",
            )

    def _replace_model_predictions(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("model_predictions").delete().eq("run_id", run_id).execute(),
            context=f"delete_model_predictions run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("model_predictions").insert(chunk).execute(),
                context=(
                    f"insert_model_predictions run_id={run_id} rows={len(chunk)} offset={start}"
                ),
            )

    def _replace_positions(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("positions").delete().eq("run_id", run_id).execute(),
            context=f"delete_positions run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("positions").insert(chunk).execute(),
                context=f"insert_positions run_id={run_id} rows={len(chunk)} offset={start}",
            )

    def _replace_model_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:
        self._execute_with_retry(
            lambda: self.client.table("model_metadata").delete().eq("run_id", run_id).execute(),
            context=f"delete_model_metadata run_id={run_id}",
        )
        self._execute_with_retry(
            lambda: self.client.table("model_metadata").insert([metadata]).execute(),
            context=f"insert_model_metadata run_id={run_id}",
        )

    def try_chain_preflight_backtest(self, job: Job) -> None:
        """After a data_ingest job completes (or fails), check whether all preflight
        ingest jobs for the linked run have settled. If so, either enqueue the
        backtest job (all succeeded) or fail the run (any failed).

        This implements the automatic chaining from waiting_for_data → queued.
        """
        run_id = job.preflight_run_id
        if not run_id:
            return

        try:
            # Fetch all preflight ingest jobs for this run (include next_retry_at for pending check)
            preflight_result = (
                self.client.table("jobs")
                .select("id,status,payload,next_retry_at")
                .eq("preflight_run_id", run_id)
                .execute()
            )
            preflight_jobs = preflight_result.data or []
            if not preflight_jobs:
                return

            # Non-terminal: queued, running, or failed-but-will-retry (has next_retry_at)
            if any(
                j["status"] in ("queued", "running")
                or (j["status"] == "failed" and j.get("next_retry_at"))
                for j in preflight_jobs
            ):
                return  # Another job will finish and call this when all are settled

            # Guard: only act if run is still waiting_for_data (idempotency check)
            run_result = (
                self.client.table("runs")
                .select("id,name,status,user_id")
                .eq("id", run_id)
                .eq("status", "waiting_for_data")
                .execute()
            )
            run_rows = run_result.data or []
            if not run_rows:
                return  # Run already handled (failed/cancelled elsewhere)
            run = run_rows[0]

            # Terminal failures: failed (no retry) or blocked
            failed_jobs = [
                j
                for j in preflight_jobs
                if j["status"] in ("failed", "blocked") and not j.get("next_retry_at")
            ]
            if failed_jobs:
                # Some ingest jobs failed permanently — block the run with a diagnostic
                failed_tickers = [str(j.get("payload", {}).get("ticker", "?")) for j in failed_jobs]
                error_msg = (
                    f"Data ingestion failed for: {', '.join(failed_tickers)}. "
                    "Coverage below threshold after ingest attempt. "
                    "Visit the Data page to retry or check the logs."
                )
                (self.client.table("runs").update({"status": "blocked"}).eq("id", run_id).execute())
                # Sentinel job so the run detail page shows the failure message
                blocked_job = (
                    self.client.table("jobs")
                    .insert(
                        {
                            "run_id": run_id,
                            "name": run["name"],
                            "status": "blocked",
                            "stage": "ingest",
                            "progress": 0,
                            "error_message": error_msg[:2000],
                        }
                    )
                    .select("id")
                    .execute()
                )
                blocked_rows = blocked_job.data or []
                if blocked_rows and blocked_rows[0].get("id"):
                    self._upsert_job_notification(
                        job_id=str(blocked_rows[0]["id"]),
                        run_id=run_id,
                        user_id=str(run.get("user_id")) if run.get("user_id") else None,
                        name=str(run["name"]),
                        status="blocked",
                        error_message=error_msg,
                    )
                print(f"[supabase_io] preflight blocked for run={run_id}: {error_msg}")
                return

            # All ingest jobs completed — enqueue the backtest job
            queued_job = (
                self.client.table("jobs")
                .insert(
                    {
                        "run_id": run_id,
                        "name": run["name"],
                        "status": "queued",
                        "stage": "ingest",
                        "progress": 0,
                    }
                )
                .select("id")
                .execute()
            )
            queued_rows = queued_job.data or []
            if queued_rows and queued_rows[0].get("id"):
                self._upsert_job_notification(
                    job_id=str(queued_rows[0]["id"]),
                    run_id=run_id,
                    user_id=str(run.get("user_id")) if run.get("user_id") else None,
                    name=str(run["name"]),
                    status="queued",
                )
            (self.client.table("runs").update({"status": "queued"}).eq("id", run_id).execute())
            print(f"[supabase_io] chained backtest for run={run_id} after preflight ingest")

        except Exception as exc:
            print(f"[supabase_io] try_chain_preflight_backtest error for run={run_id}: {exc}")

    # ---------------------------------------------------------------------------
    # data_ingest_jobs table — explicit-schema ingest job management
    # ---------------------------------------------------------------------------

    def fetch_queued_data_ingest_jobs(self, limit: int = 5) -> list[DataIngestJob]:
        """Fetch up to `limit` queued data_ingest_jobs ordered by creation time."""
        result = self._select_data_ingest_rows(
            "id,symbol,start_date,end_date,stage,attempt_count,request_mode,batch_id,target_cutoff_date,requested_by,requested_by_run_id,requested_by_user_id",
            "id,symbol,start_date,end_date,stage,attempt_count,requested_by_run_id,requested_by_user_id",
            lambda fields: (
                self.client.table("data_ingest_jobs")
                .select(fields)
                .eq("status", "queued")
                .order("created_at")
                .limit(limit)
            ),
        )
        jobs: list[DataIngestJob] = []
        for r in result.data or []:
            jobs.append(
                DataIngestJob(
                    id=r["id"],
                    symbol=str(r["symbol"]),
                    start_date=str(r["start_date"]),
                    end_date=str(r["end_date"]),
                    stage=r.get("stage"),
                    attempt_count=int(r.get("attempt_count") or 0),
                    request_mode=r.get("request_mode"),
                    batch_id=r.get("batch_id"),
                    target_cutoff_date=r.get("target_cutoff_date"),
                    requested_by=r.get("requested_by"),
                    requested_by_run_id=r.get("requested_by_run_id"),
                    requested_by_user_id=r.get("requested_by_user_id"),
                )
            )
        return jobs

    def claim_data_ingest_job(self, job: DataIngestJob) -> bool:
        """Atomically transition a data_ingest_job from queued → running.

        Returns True if the claim succeeded (this worker owns the job),
        False if another worker already claimed it.
        """
        now = datetime.now(timezone.utc).isoformat()
        try:
            payload = {
                "status": "running",
                "stage": "download",
                "progress": 5,
                "started_at": now,
                "updated_at": now,
                "last_heartbeat_at": now,
                "locked_at": now,
                "finished_at": None,
                "error": None,
                "next_retry_at": None,
            }
            for _ in range(2):
                write_payload = (
                    self._legacy_data_ingest_payload(payload)
                    if self._legacy_data_ingest_mode()
                    else dict(payload)
                )
                try:
                    claimed = (
                        self.client.table("data_ingest_jobs")
                        .update(write_payload)
                        .eq("id", job.id)
                        .eq("status", "queued")
                        .execute()
                    )
                    break
                except Exception as exc:
                    if self._legacy_data_ingest_mode():
                        raise
                    if not self._should_retry_legacy_data_ingest_write(str(exc), payload):
                        raise
                    self._legacy_data_ingest_schema = True
            return bool(claimed.data)
        except Exception as exc:
            print(f"[supabase_io] claim_data_ingest_job error job={job.id}: {exc}")
            return False

    def heartbeat_data_ingest_job(self, job_id: str) -> None:
        """Refresh updated_at to signal the job is still alive.

        Called by the _Heartbeat background thread every ~10 seconds.
        Does NOT update locked_at — locked_at is the claim timestamp and must stay
        frozen so the max-runtime stall scanner can detect jobs that heartbeat
        normally but hang indefinitely (e.g. blocked yfinance calls).
        Silently ignores all errors — a failed heartbeat must never kill a job.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            self._update_data_ingest_row(job_id, {"updated_at": now, "last_heartbeat_at": now})
        except Exception as exc:
            print(f"[supabase_io] heartbeat warning data_ingest_job={job_id}: {exc}")

    def update_data_ingest_progress(self, job_id: str, *, stage: str, progress: int) -> None:
        """Update stage and progress on a data_ingest_job; injects updated_at as heartbeat."""
        bounded = max(0, min(int(progress), 100))
        now = datetime.now(timezone.utc).isoformat()
        try:
            self._update_data_ingest_row(
                job_id,
                {
                    "stage": stage,
                    "progress": bounded,
                    "updated_at": now,
                    "last_heartbeat_at": now,
                },
            )
        except Exception as exc:
            print(f"[supabase_io] update_data_ingest_progress error job={job_id}: {exc}")

    def _describe_data_ingest_trigger(self, job: DataIngestJob) -> str:
        requested_by = (job.requested_by or "").lower()
        request_mode = (job.request_mode or "").lower()

        if request_mode == "monthly" or requested_by.startswith("cron:monthly"):
            return "scheduled monthly refresh"
        if request_mode == "daily" or requested_by.startswith("cron:daily"):
            return "daily patch"
        if request_mode == "manual" or requested_by.startswith("manual"):
            return "manual repair (admin)"
        if request_mode == "preflight" or requested_by.startswith("run-preflight"):
            return "run preflight"
        return "data repair"

    def save_data_ingest_job_success(
        self,
        job: DataIngestJob,
        duration_seconds: int,
        tickers_updated: int,
        rows_upserted: int,
        start_date: str,
        end_date: str,
    ) -> None:
        """Mark data_ingest_job succeeded, refresh cache, and finalize any batch."""
        try:
            self.client.rpc("upsert_ticker_stats", {"p_ticker": job.symbol}).execute()
        except Exception as exc:
            print(f"[supabase_io] warning: could not upsert ticker_stats for {job.symbol}: {exc}")

        now = datetime.now(timezone.utc).isoformat()
        try:
            self._update_data_ingest_row(
                job.id,
                {
                    "status": "succeeded",
                    "stage": "finalize",
                    "progress": 100,
                    "finished_at": now,
                    "updated_at": now,
                    "last_heartbeat_at": now,
                    "rows_inserted": rows_upserted,
                    "error": None,
                    "next_retry_at": None,
                },
            )
        except Exception as exc:
            print(f"[supabase_io] save_data_ingest_job_success update error job={job.id}: {exc}")

        try:
            note_prefix = self._describe_data_ingest_trigger(job)
            self.client.table("data_ingestion_log").insert(
                {
                    "status": "success",
                    "tickers_updated": tickers_updated,
                    "rows_upserted": rows_upserted,
                    "note": f"{note_prefix} {job.symbol} ({start_date} to {end_date})",
                    "source": "yfinance",
                }
            ).execute()
        except Exception as exc:
            print(f"[supabase_io] warning: could not write data_ingestion_log: {exc}")

        self.try_finalize_scheduled_refresh_batch(job)
        self.try_chain_preflight_backtest_v2(job)

    def try_finalize_scheduled_refresh_batch(self, job: DataIngestJob) -> None:
        """Advance data_state when a scheduled refresh batch is complete.

        Finalization rules:
        - All in-flight jobs (queued / running / retrying) must finish first.
        - All BENCHMARK tickers must have status="succeeded".
        - Non-benchmark tickers may be in any terminal state (succeeded / blocked / failed).
        - At least one job must have succeeded (sanity guard).

        This relaxed rule means a single blocked/delisted equity constituent
        (e.g. a removed NASDAQ100 stock) no longer prevents data_state from
        advancing for the entire pipeline.
        """
        if not job.batch_id or job.request_mode not in ("monthly", "daily"):
            return
        if not job.target_cutoff_date:
            return

        try:
            result = (
                self.client.table("data_ingest_jobs")
                .select("id,symbol,status")
                .eq("batch_id", job.batch_id)
                .execute()
            )
            batch_jobs = result.data or []
            if not batch_jobs:
                return

            # Wait for all in-flight jobs to settle.
            if any(j["status"] in ("queued", "running", "retrying") for j in batch_jobs):
                return

            # All benchmark tickers must have succeeded.
            benchmark_jobs = [j for j in batch_jobs if j.get("symbol") in _BENCHMARK_TICKERS]
            if benchmark_jobs and any(j["status"] != "succeeded" for j in benchmark_jobs):
                blocked = [j["symbol"] for j in benchmark_jobs if j["status"] != "succeeded"]
                print(
                    f"[supabase_io] batch={job.batch_id} benchmarks not succeeded: {blocked} "
                    f"— will not advance data_state"
                )
                return

            # Non-benchmark tickers must be in a terminal state (no retrying/running/queued).
            non_benchmark_inflight = [
                j
                for j in batch_jobs
                if j.get("symbol") not in _BENCHMARK_TICKERS
                and j["status"] in ("queued", "running", "retrying")
            ]
            if non_benchmark_inflight:
                return

            # Sanity: at least one job must have succeeded.
            if not any(j["status"] == "succeeded" for j in batch_jobs):
                return

            succeeded = sum(1 for j in batch_jobs if j["status"] == "succeeded")
            skipped = len(batch_jobs) - succeeded

            now_iso = datetime.now(timezone.utc).isoformat()
            self.client.table("data_state").upsert(
                {
                    "id": 1,
                    "data_cutoff_date": job.target_cutoff_date,
                    "last_update_at": now_iso,
                    "update_mode": job.request_mode,
                    "updated_by": job.requested_by or job.request_mode,
                }
            ).execute()

            symbols = sorted({str(j.get("symbol")) for j in batch_jobs if j.get("symbol")})
            for symbol in symbols:
                try:
                    self.client.rpc("upsert_ticker_stats", {"p_ticker": symbol}).execute()
                except Exception as exc:
                    print(
                        f"[supabase_io] warning: could not refresh ticker_stats for {symbol}: {exc}"
                    )

            print(
                f"[supabase_io] finalized {job.request_mode} refresh batch={job.batch_id} "
                f"cutoff={job.target_cutoff_date} succeeded={succeeded} skipped={skipped}"
            )
        except Exception as exc:
            print(
                f"[supabase_io] try_finalize_scheduled_refresh_batch error "
                f"batch={job.batch_id}: {exc}"
            )

    def save_data_ingest_job_failure_with_retry(
        self,
        job: DataIngestJob,
        duration_seconds: int,
        error_message: str,
        *,
        stage: str = "download",
    ) -> None:
        """Mark data_ingest_job retrying and schedule an automatic retry with backoff."""
        next_attempt = job.attempt_count + 1
        max_attempts = _get_data_ingest_max_attempts(job.request_mode)
        delay = _get_retry_delay(next_attempt)
        next_retry_at = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()
        now = datetime.now(timezone.utc).isoformat()
        if next_attempt < max_attempts:
            try:
                self._update_data_ingest_row(
                    job.id,
                    {
                        "status": "retrying",
                        "stage": stage,
                        "progress": 100,
                        "finished_at": now,
                        "updated_at": now,
                        "last_heartbeat_at": now,
                        "error": error_message[:2000],
                        "attempt_count": next_attempt,
                        "next_retry_at": next_retry_at,
                        "deferred_to_monthly": False,
                    },
                )
            except Exception as exc:
                print(
                    f"[supabase_io] save_data_ingest_job_failure_with_retry error job={job.id}: {exc}"
                )
            print(
                f"[supabase_io] ingest job={job.id} symbol={job.symbol} failed (attempt {next_attempt}), "
                f"retry in {delay}s at {next_retry_at}"
            )
            return

        deferred_to_monthly = (job.request_mode or "").lower() == "daily"
        try:
            self._update_data_ingest_row(
                job.id,
                {
                    "status": "failed",
                    "stage": stage,
                    "progress": 100,
                    "finished_at": now,
                    "updated_at": now,
                    "last_heartbeat_at": now,
                    "error": error_message[:2000],
                    "attempt_count": next_attempt,
                    "next_retry_at": None,
                    "deferred_to_monthly": deferred_to_monthly,
                },
            )
        except Exception as exc:
            print(
                f"[supabase_io] save_data_ingest_job_failure_with_retry error job={job.id}: {exc}"
            )
        print(
            f"[supabase_io] ingest job={job.id} symbol={job.symbol} permanently failed "
            f"after {next_attempt} attempt(s)"
        )

    def save_data_ingest_job_blocked(
        self,
        job: DataIngestJob,
        duration_seconds: int,
        error_message: str,
        *,
        stage: str = "download",
    ) -> None:
        """Mark data_ingest_job permanently blocked (no auto-retry), then chain preflight."""
        now = datetime.now(timezone.utc).isoformat()
        try:
            self._update_data_ingest_row(
                job.id,
                {
                    "status": "blocked",
                    "stage": stage,
                    "progress": 100,
                    "finished_at": now,
                    "updated_at": now,
                    "last_heartbeat_at": now,
                    "error": f"[blocked] {error_message[:1980]}",
                    "next_retry_at": None,
                },
            )
        except Exception as exc:
            print(f"[supabase_io] save_data_ingest_job_blocked error job={job.id}: {exc}")
        print(
            f"[supabase_io] ingest job={job.id} symbol={job.symbol} BLOCKED: {error_message[:200]}"
        )
        self.try_chain_preflight_backtest_v2(job)

    def scan_stalled_data_ingest_jobs(self, stall_minutes: int = 2, max_attempts: int = 5) -> None:
        """Detect running data_ingest_jobs that are stuck and schedule retries.

        Two detection paths:
          1. Primary — heartbeat gone silent: last_heartbeat_at older than stall_minutes.
          2. Secondary — heartbeat alive but job exceeded max runtime: started_at
             older than _INGEST_MAX_RUNTIME_SECONDS. This catches yfinance calls that
             block indefinitely while the heartbeat background thread keeps firing.
        """
        try:
            now_utc = datetime.now(timezone.utc)
            cutoff_heartbeat = (now_utc - timedelta(minutes=stall_minutes)).isoformat()
            cutoff_max_runtime = (
                now_utc - timedelta(seconds=_INGEST_MAX_RUNTIME_SECONDS)
            ).isoformat()

            # Primary: heartbeat gone silent
            result_silent = self._select_data_ingest_rows(
                "id,stage,attempt_count,request_mode,batch_id,target_cutoff_date,requested_by,requested_by_run_id,symbol",
                "id,stage,attempt_count,requested_by_run_id,symbol",
                lambda fields: (
                    self.client.table("data_ingest_jobs")
                    .select(fields)
                    .eq("status", "running")
                    .lt("last_heartbeat_at", cutoff_heartbeat)
                ),
            )
            # Secondary: heartbeat alive but running too long
            result_maxtime = self._select_data_ingest_rows(
                "id,stage,attempt_count,request_mode,batch_id,target_cutoff_date,requested_by,requested_by_run_id,symbol",
                "id,stage,attempt_count,requested_by_run_id,symbol",
                lambda fields: (
                    self.client.table("data_ingest_jobs")
                    .select(fields)
                    .eq("status", "running")
                    .lt("started_at", cutoff_max_runtime)
                    .not_.is_("started_at", "null")
                ),
            )
            # Deduplicate by id (a single job may appear in both result sets)
            seen_ids: set[str] = set()
            stalled: list[dict] = []
            for row in (result_silent.data or []) + (result_maxtime.data or []):
                if row["id"] not in seen_ids:
                    seen_ids.add(row["id"])
                    stalled.append(row)

            if not stalled:
                return

            print(f"[supabase_io] scan found {len(stalled)} stalled data_ingest_job(s)")
            now_iso = datetime.now(timezone.utc).isoformat()
            for row in stalled:
                job_id = row["id"]
                attempt = int(row.get("attempt_count") or 0)
                next_attempt = attempt + 1
                allowed_attempts = min(
                    max_attempts, _get_data_ingest_max_attempts(row.get("request_mode"))
                )

                if next_attempt < allowed_attempts:
                    delay = _get_retry_delay(next_attempt)
                    next_retry_at = (
                        datetime.now(timezone.utc) + timedelta(seconds=delay)
                    ).isoformat()
                    self._update_data_ingest_row(
                        job_id,
                        {
                            "status": "retrying",
                            "stage": row.get("stage") or "download",
                            "attempt_count": next_attempt,
                            "next_retry_at": next_retry_at,
                            "updated_at": now_iso,
                            "last_heartbeat_at": now_iso,
                            "error": (
                                f"[stalled] no heartbeat for {stall_minutes}m "
                                f"(attempt {next_attempt}/{allowed_attempts}). Retry in {delay}s."
                            ),
                            "deferred_to_monthly": False,
                        },
                    )
                    print(
                        f"[supabase_io] stalled data_ingest_job={job_id} "
                        f"attempt={next_attempt} retry_at={next_retry_at}"
                    )
                else:
                    deferred_to_monthly = (row.get("request_mode") or "").lower() == "daily"
                    error_msg = (
                        f"[stalled] no heartbeat for {stall_minutes}m after "
                        f"{next_attempt} attempt(s). Worker likely crashed mid-job."
                    )
                    self._update_data_ingest_row(
                        job_id,
                        {
                            "status": "failed",
                            "progress": 100,
                            "stage": row.get("stage") or "download",
                            "attempt_count": next_attempt,
                            "finished_at": now_iso,
                            "updated_at": now_iso,
                            "last_heartbeat_at": now_iso,
                            "next_retry_at": None,
                            "error": error_msg[:2000],
                            "deferred_to_monthly": deferred_to_monthly,
                        },
                    )
                    print(
                        f"[supabase_io] permanently failed stalled data_ingest_job={job_id} "
                        f"(exhausted {next_attempt} attempts)"
                    )
                    run_id = row.get("requested_by_run_id")
                    if run_id:
                        fake_job = DataIngestJob(
                            id=job_id,
                            symbol=str(row.get("symbol", "?")),
                            start_date="",
                            end_date="",
                            stage=row.get("stage"),
                            attempt_count=next_attempt,
                            request_mode=row.get("request_mode"),
                            batch_id=row.get("batch_id"),
                            target_cutoff_date=row.get("target_cutoff_date"),
                            requested_by=row.get("requested_by"),
                            requested_by_run_id=run_id,
                        )
                        self.try_chain_preflight_backtest_v2(fake_job)

        except Exception as exc:
            if self._is_missing_data_ingest_column_error(exc):
                self._legacy_data_ingest_schema = True
                return
            print(f"[supabase_io] scan_stalled_data_ingest_jobs error: {exc}")

    def scan_queued_too_long_data_ingest(
        self, timeout_minutes: int = 10, max_attempts: int = 5
    ) -> None:
        """Detect data_ingest_jobs stuck in queued state (worker not running)."""
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)).isoformat()
            result = self._select_data_ingest_rows(
                "id,stage,attempt_count,request_mode,batch_id,target_cutoff_date,requested_by,requested_by_run_id,symbol",
                "id,stage,attempt_count,requested_by_run_id,symbol",
                lambda fields: (
                    self.client.table("data_ingest_jobs")
                    .select(fields)
                    .eq("status", "queued")
                    .lt("created_at", cutoff)
                ),
            )
            stuck = result.data or []
            if not stuck:
                return

            print(f"[supabase_io] scan found {len(stuck)} queued-too-long data_ingest_job(s)")
            now_iso = datetime.now(timezone.utc).isoformat()
            for row in stuck:
                job_id = row["id"]
                attempt = int(row.get("attempt_count") or 0)
                next_attempt = attempt + 1
                allowed_attempts = min(
                    max_attempts, _get_data_ingest_max_attempts(row.get("request_mode"))
                )

                if next_attempt < allowed_attempts:
                    next_retry_at = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
                    self._update_data_ingest_row(
                        job_id,
                        {
                            "status": "retrying",
                            "attempt_count": next_attempt,
                            "next_retry_at": next_retry_at,
                            "updated_at": now_iso,
                            "last_heartbeat_at": now_iso,
                            "deferred_to_monthly": False,
                            "error": (
                                f"[queued-too-long] queued for >{timeout_minutes}m without being claimed. "
                                "Worker may not be running. Retry in 30s."
                            ),
                        },
                    )
                else:
                    deferred_to_monthly = (row.get("request_mode") or "").lower() == "daily"
                    error_msg = (
                        f"[queued-too-long] queued for >{timeout_minutes}m after "
                        f"{next_attempt} attempt(s). No worker available."
                    )
                    self._update_data_ingest_row(
                        job_id,
                        {
                            "status": "failed",
                            "progress": 100,
                            "attempt_count": next_attempt,
                            "finished_at": now_iso,
                            "updated_at": now_iso,
                            "last_heartbeat_at": now_iso,
                            "next_retry_at": None,
                            "error": error_msg[:2000],
                            "deferred_to_monthly": deferred_to_monthly,
                        },
                    )
                    run_id = row.get("requested_by_run_id")
                    if run_id:
                        fake_job = DataIngestJob(
                            id=job_id,
                            symbol=str(row.get("symbol", "?")),
                            start_date="",
                            end_date="",
                            attempt_count=next_attempt,
                            request_mode=row.get("request_mode"),
                            batch_id=row.get("batch_id"),
                            target_cutoff_date=row.get("target_cutoff_date"),
                            requested_by=row.get("requested_by"),
                            requested_by_run_id=run_id,
                        )
                        self.try_chain_preflight_backtest_v2(fake_job)

        except Exception as exc:
            if self._is_missing_data_ingest_column_error(exc):
                self._legacy_data_ingest_schema = True
                return
            print(f"[supabase_io] scan_queued_too_long_data_ingest error: {exc}")

    def requeue_due_data_ingest(self, max_attempts: int = 5) -> None:
        """Re-queue retrying data_ingest_jobs whose next_retry_at has arrived."""
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            retry_status = "failed" if self._legacy_data_ingest_mode() else "retrying"
            result = (
                self.client.table("data_ingest_jobs")
                .select("id,attempt_count,request_mode")
                .eq("status", retry_status)
                .lte("next_retry_at", now_iso)
                .not_.is_("next_retry_at", "null")
                .execute()
            )
            due = result.data or []
            if not due:
                return

            print(f"[supabase_io] requeueing {len(due)} due-for-retry data_ingest_job(s)")
            for row in due:
                allowed_attempts = min(
                    max_attempts, _get_data_ingest_max_attempts(row.get("request_mode"))
                )
                if int(row.get("attempt_count") or 0) >= allowed_attempts:
                    deferred_to_monthly = (row.get("request_mode") or "").lower() == "daily"
                    self._update_data_ingest_row(
                        row["id"],
                        {
                            "status": "failed",
                            "progress": 100,
                            "finished_at": now_iso,
                            "next_retry_at": None,
                            "error": "[retry-exhausted] automatic retries exhausted.",
                            "updated_at": now_iso,
                            "last_heartbeat_at": now_iso,
                            "deferred_to_monthly": deferred_to_monthly,
                        },
                    )
                    continue
                self._update_data_ingest_row(
                    row["id"],
                    {
                        "status": "queued",
                        "stage": None,
                        "progress": 0,
                        "finished_at": None,
                        "next_retry_at": None,
                        "error": None,
                        "updated_at": now_iso,
                        "last_heartbeat_at": now_iso,
                        "deferred_to_monthly": False,
                    },
                )
                print(
                    f"[supabase_io] requeued data_ingest_job={row['id']} "
                    f"attempt_count={row['attempt_count']}"
                )
        except Exception as exc:
            if self._is_missing_data_ingest_column_error(exc):
                self._legacy_data_ingest_schema = True
                return
            print(f"[supabase_io] requeue_due_data_ingest error: {exc}")

    def try_chain_preflight_backtest_v2(self, job: DataIngestJob) -> None:
        """After a data_ingest_job settles, chain to backtest if all preflight jobs are terminal.

        Mirrors try_chain_preflight_backtest but uses the data_ingest_jobs table.
        """
        run_id = job.requested_by_run_id
        if not run_id:
            return

        try:
            preflight_result = (
                self.client.table("data_ingest_jobs")
                .select("id,symbol,status,next_retry_at")
                .eq("requested_by_run_id", run_id)
                .execute()
            )
            preflight_jobs = preflight_result.data or []
            if not preflight_jobs:
                return

            # Non-terminal: queued, running, retrying, or failed-but-will-retry
            if any(
                self._normalize_data_ingest_status(j["status"]) in ("queued", "running", "retrying")
                or (
                    self._normalize_data_ingest_status(j["status"]) == "failed"
                    and j.get("next_retry_at")
                )
                for j in preflight_jobs
            ):
                return

            # Guard: only act if run is still waiting_for_data
            run_result = (
                self.client.table("runs")
                .select("id,name,status,user_id")
                .eq("id", run_id)
                .eq("status", "waiting_for_data")
                .execute()
            )
            run_rows = run_result.data or []
            if not run_rows:
                return
            run = run_rows[0]

            failed_jobs = [
                j
                for j in preflight_jobs
                if self._normalize_data_ingest_status(j["status"]) in ("failed", "blocked")
                and not j.get("next_retry_at")
            ]
            if failed_jobs:
                failed_symbols = [str(j.get("symbol", "?")) for j in failed_jobs]
                error_msg = (
                    f"Data ingestion failed for: {', '.join(failed_symbols)}. "
                    "Coverage below threshold after ingest attempt. "
                    "Visit the Data page to retry or check the logs."
                )
                self.client.table("runs").update({"status": "blocked"}).eq("id", run_id).execute()
                blocked_job = (
                    self.client.table("jobs")
                    .insert(
                        {
                            "run_id": run_id,
                            "name": run["name"],
                            "status": "blocked",
                            "stage": "ingest",
                            "progress": 0,
                            "error_message": error_msg[:2000],
                        }
                    )
                    .select("id")
                    .execute()
                )
                blocked_rows = blocked_job.data or []
                if blocked_rows and blocked_rows[0].get("id"):
                    self._upsert_job_notification(
                        job_id=str(blocked_rows[0]["id"]),
                        run_id=run_id,
                        user_id=str(run.get("user_id")) if run.get("user_id") else None,
                        name=str(run["name"]),
                        status="blocked",
                        error_message=error_msg,
                    )
                print(f"[supabase_io] preflight v2 blocked for run={run_id}: {error_msg}")
                return

            # All succeeded — enqueue backtest
            queued_job = (
                self.client.table("jobs")
                .insert(
                    {
                        "run_id": run_id,
                        "name": run["name"],
                        "status": "queued",
                        "stage": "ingest",
                        "progress": 0,
                    }
                )
                .select("id")
                .execute()
            )
            queued_rows = queued_job.data or []
            if queued_rows and queued_rows[0].get("id"):
                self._upsert_job_notification(
                    job_id=str(queued_rows[0]["id"]),
                    run_id=run_id,
                    user_id=str(run.get("user_id")) if run.get("user_id") else None,
                    name=str(run["name"]),
                    status="queued",
                )
            self.client.table("runs").update({"status": "queued"}).eq("id", run_id).execute()
            print(f"[supabase_io] chained backtest (v2) for run={run_id} after preflight ingest")

        except Exception as exc:
            print(f"[supabase_io] try_chain_preflight_backtest_v2 error for run={run_id}: {exc}")

    def create_or_widen_data_ingest_job(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        requested_by_run_id: str | None = None,
        requested_by_user_id: str | None = None,
    ) -> tuple[str, bool]:
        """Insert a new data_ingest_job or widen an existing queued job's date range.

        Returns (job_id, already_active) where already_active=True means a running or
        widened-queued job was found and no new row was inserted.
        """
        try:
            result = (
                self.client.table("data_ingest_jobs")
                .select("id,status,start_date,end_date")
                .eq("symbol", symbol)
                .in_("status", ["queued", "running", "retrying"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            existing = (result.data or [None])[0]
            if existing:
                if existing["status"] == "queued":
                    new_start = min(str(existing["start_date"]), start_date)
                    new_end = max(str(existing["end_date"]), end_date)
                    self.client.table("data_ingest_jobs").update(
                        {
                            "start_date": new_start,
                            "end_date": new_end,
                        }
                    ).eq("id", existing["id"]).execute()
                    return existing["id"], True
                return existing["id"], True  # running — caller should treat as already_active
        except Exception as exc:
            print(f"[supabase_io] create_or_widen check error for {symbol}: {exc}")

        # Insert new job
        payload: dict[str, Any] = {
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "status": "queued",
            "stage": "download",
            "progress": 0,
        }
        if requested_by_run_id:
            payload["requested_by_run_id"] = requested_by_run_id
        if requested_by_user_id:
            payload["requested_by_user_id"] = requested_by_user_id
        try:
            insert_result = (
                self.client.table("data_ingest_jobs").insert(payload).select("id").execute()
            )
            rows = insert_result.data or []
            if not rows:
                raise RuntimeError(f"Insert returned no id for {symbol}")
            return str(rows[0]["id"]), False
        except Exception as exc:
            raise RuntimeError(f"Failed to insert data_ingest_job for {symbol}: {exc}") from exc
