from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .client import Job, _get_retry_delay


class LegacyIngestRepositoryMixin:
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
