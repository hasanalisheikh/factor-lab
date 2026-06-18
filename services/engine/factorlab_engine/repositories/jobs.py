from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .client import _WORKER_ID, Job
from .jobs_retries import JobsRetryRepositoryMixin


class JobsRepositoryMixin(JobsRetryRepositoryMixin):
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
