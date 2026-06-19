from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .client import Job, _get_retry_delay


class JobsRetryRepositoryMixin:
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
                    .select(
                        "id, run_id, name, stage, attempt_count, preflight_run_id, payload, job_type"
                    )
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
                    .select(
                        "id, run_id, name, stage, attempt_count, preflight_run_id, payload, job_type"
                    )
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

                    if row.get("job_type", "backtest") == "backtest" and row.get("run_id"):
                        run_id = str(row["run_id"])
                        self.client.table("runs").update({"status": "failed"}).eq(
                            "id", run_id
                        ).execute()
                        failed_job = Job(
                            id=job_id,
                            run_id=run_id,
                            name=str(row.get("name") or "Backtest"),
                        )
                        self._sync_backtest_notification(
                            failed_job,
                            status="failed",
                            error_message=error_msg[:2000],
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
        """Re-queue failed jobs whose next_retry_at has arrived.

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
                .select("id, run_id, attempt_count, job_type")
                .eq("status", "failed")
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
                job_type = row.get("job_type") or "backtest"
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
                if job_type == "backtest" and row.get("run_id"):
                    self.client.table("runs").update({"status": "queued"}).eq(
                        "id", row["run_id"]
                    ).execute()
                print(
                    f"[supabase_io] requeued retry job={row['id']} "
                    f"attempt_count={row['attempt_count']}"
                )
        except Exception as exc:
            print(f"[supabase_io] requeue_due_for_retry error: {exc}")
