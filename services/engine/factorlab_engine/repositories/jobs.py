from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .client import _WORKER_ID, Job, _get_retry_delay


class JobsRepositoryMixin:
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
