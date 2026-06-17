from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .client import (
    _BENCHMARK_TICKERS,
    DataIngestJob,
    _get_data_ingest_max_attempts,
    _get_retry_delay,
)


class DataIngestJobsRepositoryMixin:
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
