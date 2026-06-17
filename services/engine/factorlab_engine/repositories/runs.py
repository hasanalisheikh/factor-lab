from __future__ import annotations

from typing import Any

from .client import DataIngestJob, Job


class RunsRepositoryMixin:
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
