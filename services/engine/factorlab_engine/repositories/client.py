from __future__ import annotations

import os
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from supabase import Client, create_client

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


class ClientRepositoryMixin:
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
