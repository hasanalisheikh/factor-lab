from __future__ import annotations

import concurrent.futures
import io
import time
from typing import Any

import pandas as pd
import requests
import yfinance as yf

from factorlab_engine.supabase_io import Job, SupabaseIO

from .progress import _Heartbeat
from .settings import (
    _INGEST_ATTEMPT_TIMEOUT_SECONDS,
    _INGEST_BACKOFF_SECONDS,
    _INGEST_HTTP_TIMEOUT_SECONDS,
    _INGEST_MAX_RETRIES,
    _utc_today_str,
    _utcnow,
)

_BLOCKED_ERROR_PATTERNS: list[str] = [
    "no timezone found for ticker",
    "no price data available",
    "possibly delisted",
    "no data found for ticker",
    "symbol not found",
    "invalid ticker",
    "404",
    "403 forbidden",
]


def _classify_ingest_error(error: str) -> str:
    """Classify an ingest exception as 'blocked' (permanent) or 'retriable' (transient).

    'blocked' errors indicate a permanent issue (invalid ticker, delisted symbol, etc.)
    and should not be retried automatically. 'retriable' errors are transient (network,
    timeout) and will be scheduled for automatic retry with exponential backoff.
    """
    lower = error.lower()
    for pattern in _BLOCKED_ERROR_PATTERNS:
        if pattern in lower:
            return "blocked"
    return "retriable"


def _download_data_ingest_prices(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    return yf.download(
        tickers=[ticker],
        start=start_date,
        end=(pd.to_datetime(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
        threads=False,
        timeout=_INGEST_HTTP_TIMEOUT_SECONDS,
    )


def _download_data_ingest_with_retry(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    last_exc: Exception | None = None
    for attempt in range(1, _INGEST_MAX_RETRIES + 1):
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_download_data_ingest_prices, ticker, start_date, end_date)
                return future.result(timeout=_INGEST_ATTEMPT_TIMEOUT_SECONDS)
        except Exception as exc:
            last_exc = exc
            if attempt >= _INGEST_MAX_RETRIES:
                break
            backoff = _INGEST_BACKOFF_SECONDS[min(attempt - 1, len(_INGEST_BACKOFF_SECONDS) - 1)]
            time.sleep(backoff)

    raise RuntimeError(
        f"download failed after {_INGEST_MAX_RETRIES} attempts: {last_exc}"
    ) from last_exc


def _download_stooq_prices(ticker: str, start_date: str, end_date: str) -> pd.Series:
    """Fallback price download from stooq.com via direct CSV fetch.

    Only called when FACTORLAB_FALLBACK_PROVIDER=stooq and the primary yfinance
    download returns sparse data (<50% of expected business days).

    Stooq symbol convention: lowercase + '.us' suffix; hyphens become dots
    (e.g., BRK-B → brk.b.us). Returns an empty Series on any error.
    """
    stooq_sym = ticker.replace("-", ".").lower() + ".us"
    d1 = start_date.replace("-", "")
    d2 = end_date.replace("-", "")
    url = f"https://stooq.com/q/d/l/?s={stooq_sym}&d1={d1}&d2={d2}&i=d"
    try:
        resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        text = resp.text.strip()
        if not text or "No data" in text or len(text) < 60:
            return pd.Series(dtype=float)
        df = pd.read_csv(io.StringIO(text), parse_dates=["Date"], index_col="Date")
        if "Close" not in df.columns:
            return pd.Series(dtype=float)
        return df["Close"].sort_index().dropna()
    except Exception as exc:
        print(f"[engine] stooq fallback failed for {ticker}: {exc}")
        return pd.Series(dtype=float)


def _fetch_existing_price_bounds(io: SupabaseIO, ticker: str) -> tuple[str | None, str | None]:
    """Return the earliest/latest stored price dates for a ticker."""
    try:
        latest_result = (
            io.client.table("prices")
            .select("date")
            .eq("ticker", ticker)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        existing_latest = latest_result.data[0]["date"] if latest_result.data else None
    except Exception:
        existing_latest = None

    try:
        earliest_result = (
            io.client.table("prices")
            .select("date")
            .eq("ticker", ticker)
            .order("date")
            .limit(1)
            .execute()
        )
        existing_earliest = earliest_result.data[0]["date"] if earliest_result.data else None
    except Exception:
        existing_earliest = None

    return existing_earliest, existing_latest


def _resolve_incremental_ingest_window(
    requested_start: str,
    requested_end: str,
    *,
    existing_earliest: str | None,
    existing_latest: str | None,
) -> tuple[str, str, bool]:
    """Resolve the effective download window for an incremental ingest request."""
    requested_start_ts = pd.Timestamp(requested_start)
    requested_end_ts = pd.Timestamp(requested_end)

    if existing_latest:
        existing_latest_ts = pd.Timestamp(existing_latest)
        next_day_ts = existing_latest_ts + pd.Timedelta(days=1)

        historical_gap_end_ts: pd.Timestamp | None = None
        if existing_earliest:
            existing_earliest_ts = pd.Timestamp(existing_earliest)
            if existing_earliest_ts > requested_start_ts:
                historical_gap_end_ts = min(
                    requested_end_ts,
                    existing_earliest_ts - pd.Timedelta(days=1),
                )
                if historical_gap_end_ts < requested_start_ts:
                    historical_gap_end_ts = None

        if next_day_ts > requested_end_ts:
            if historical_gap_end_ts is not None:
                return (
                    requested_start,
                    historical_gap_end_ts.strftime("%Y-%m-%d"),
                    False,
                )
            return existing_latest, existing_latest, True

        if requested_start_ts > existing_latest_ts:
            return next_day_ts.strftime("%Y-%m-%d"), requested_end, False

    return requested_start, requested_end, False


def _process_data_ingest_job(io: SupabaseIO, job: Job) -> None:
    """Download and upsert historical prices for a single benchmark ticker."""
    started = _utcnow()
    payload = job.payload or {}
    ticker = str(payload.get("ticker", "")).strip().upper()
    if not ticker:
        io.save_failure(
            job,
            0,
            "[stage=download] data_ingest job is missing ticker in payload",
            stage="download",
        )
        return

    default_start = "1993-01-01"
    start_date = str(payload.get("start_date", default_start))
    end_date = str(payload.get("end_date", _utc_today_str()))

    # Wrap all blocking work in a heartbeat context so the stall scanner can
    # distinguish an alive job from a crashed one (heartbeat fires every 10 s).
    with _Heartbeat(lambda: io.heartbeat_job(job.id), interval=10, job_id=job.id):
        existing_earliest, existing_latest = _fetch_existing_price_bounds(io, ticker)
        start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
            start_date,
            end_date,
            existing_earliest=existing_earliest,
            existing_latest=existing_latest,
        )
        if is_fully_covered:
            duration = int((_utcnow() - started).total_seconds())
            io.save_data_ingest_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=0,
                start_date=existing_latest,
                end_date=existing_latest,
            )
            print(
                f"[engine] data_ingest skipped job={job.id} {ticker} already current ({existing_latest})"
            )
            return

        print(f"[engine] data_ingest job={job.id} ticker={ticker} {start_date}→{end_date}")
        stage = "download"
        try:
            io.update_job_progress(job.id, stage=stage, progress=15)

            # Download without the 40-row guard used by backtests — incremental updates
            # may legitimately produce only a handful of new rows.
            raw = _download_data_ingest_with_retry(ticker, start_date, end_date)
            if raw.empty:
                # No new trading days in range (e.g. weekend/holiday at end of window).
                duration = int((_utcnow() - started).total_seconds())
                actual = existing_latest or start_date
                io.update_job_progress(job.id, stage="finalize", progress=95)
                io.save_data_ingest_success(
                    job=job,
                    duration_seconds=duration,
                    tickers_updated=1,
                    rows_upserted=0,
                    start_date=actual,
                    end_date=actual,
                )
                print(f"[engine] data_ingest completed job={job.id} no new rows")
                return

            # Normalise to a Series of close prices.
            stage = "transform"
            io.update_job_progress(job.id, stage=stage, progress=45)
            if isinstance(raw.columns, pd.MultiIndex):
                level0 = raw.columns.get_level_values(0)
                key = "Close" if "Close" in level0 else "Adj Close"
                close_raw = raw[key]
                close_series = (
                    close_raw.iloc[:, 0] if isinstance(close_raw, pd.DataFrame) else close_raw
                )
            else:
                close_series = raw.iloc[:, 0]
            close_series = close_series.sort_index().ffill().dropna()

            # Build upsert rows
            stage = "upsert_prices"
            io.update_job_progress(job.id, stage=stage, progress=70)
            price_rows: list[dict[str, Any]] = []
            for dt, val in close_series.items():
                if pd.isna(val):
                    continue
                price_rows.append(
                    {
                        "ticker": ticker,
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "adj_close": float(val),
                    }
                )

            # Upsert in larger chunks to reduce Supabase round-trips
            chunk_size = 5000
            for i in range(0, len(price_rows), chunk_size):
                chunk = price_rows[i : i + chunk_size]
                io.client.table("prices").upsert(chunk, on_conflict="ticker,date").execute()

            stage = "finalize"
            io.update_job_progress(job.id, stage=stage, progress=95)

            duration = int((_utcnow() - started).total_seconds())
            actual_start = price_rows[0]["date"] if price_rows else start_date
            actual_end = price_rows[-1]["date"] if price_rows else end_date
            io.save_data_ingest_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=len(price_rows),
                start_date=actual_start,
                end_date=actual_end,
            )
            print(
                f"[engine] data_ingest completed job={job.id} {len(price_rows)} rows in {duration}s"
            )
        except Exception as exc:
            duration = int((_utcnow() - started).total_seconds())
            err_str = f"[stage={stage}] {exc}"
            # Log first so the error is always visible even if the DB write fails.
            print(f"[engine] data_ingest failed job={job.id} in {duration}s: {exc}")
            classification = _classify_ingest_error(str(exc))
            if classification == "blocked":
                io.save_blocked(job, duration, err_str, stage=stage)
                print(f"[engine] data_ingest BLOCKED job={job.id} (permanent): {exc}")
            else:
                io.save_data_ingest_failure_with_retry(job, duration, err_str, stage=stage)
