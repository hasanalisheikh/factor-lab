from __future__ import annotations

from datetime import datetime, timezone

from .client import _BENCHMARK_TICKERS, DataIngestJob


class DataIngestJobBatchesRepositoryMixin:
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
