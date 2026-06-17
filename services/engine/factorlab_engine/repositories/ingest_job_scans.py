from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .client import (
    _INGEST_MAX_RUNTIME_SECONDS,
    DataIngestJob,
    _get_data_ingest_max_attempts,
    _get_retry_delay,
)


class DataIngestJobScansRepositoryMixin:
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
