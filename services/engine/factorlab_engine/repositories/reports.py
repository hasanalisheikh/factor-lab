from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from .client import Job


class ReportsRepositoryMixin:
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
