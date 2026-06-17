from __future__ import annotations

import os
from typing import Any

import pandas as pd

from factorlab_engine.supabase_io import DataIngestJob, SupabaseIO

from .ingest_legacy import (
    _classify_ingest_error,
    _download_data_ingest_with_retry,
    _download_stooq_prices,
    _fetch_existing_price_bounds,
    _resolve_incremental_ingest_window,
)
from .progress import _Heartbeat
from .settings import _utcnow


def _make_year_chunks(start_date: str, end_date: str) -> list[tuple[str, str]]:
    """Split a date range into year-sized chunks.

    Prevents yfinance from hanging on 10+ year requests by downloading year by
    year. Returns a list of (chunk_start, chunk_end) YYYY-MM-DD tuples.
    Single-year or shorter ranges return one chunk (no overhead).
    """
    chunks: list[tuple[str, str]] = []
    chunk_start = pd.Timestamp(start_date)
    end_ts = pd.Timestamp(end_date)
    while chunk_start <= end_ts:
        # Advance by one year, then back one day to avoid overlap
        chunk_end = min(
            chunk_start + pd.DateOffset(years=1) - pd.Timedelta(days=1),
            end_ts,
        )
        chunks.append((chunk_start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        chunk_start = chunk_end + pd.Timedelta(days=1)
    return chunks if chunks else [(start_date, end_date)]


def _extract_close_series(raw: "pd.DataFrame") -> "pd.Series":
    """Extract and clean the close price series from a yfinance DataFrame."""
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = raw.columns.get_level_values(0)
        key = "Close" if "Close" in level0 else "Adj Close"
        close_raw = raw[key]
        close_series = close_raw.iloc[:, 0] if isinstance(close_raw, pd.DataFrame) else close_raw
    else:
        close_series = raw.iloc[:, 0]
    return close_series.sort_index().ffill().dropna()


def _process_data_ingest_job_v2(io: SupabaseIO, job: DataIngestJob) -> None:
    """Download and upsert historical prices for a data_ingest_jobs row.

    Uses the dedicated data_ingest_jobs table (explicit schema) rather than the
    generic jobs table. Heartbeat fires every 10 s via heartbeat_data_ingest_job.
    Large date ranges (> 1 year) are downloaded in year-sized chunks to prevent
    yfinance timeouts.
    """
    started = _utcnow()

    with _Heartbeat(lambda: io.heartbeat_data_ingest_job(job.id), interval=10, job_id=job.id):
        start_date = job.start_date
        end_date = job.end_date
        existing_earliest, existing_latest = _fetch_existing_price_bounds(io, job.symbol)
        start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
            start_date,
            end_date,
            existing_earliest=existing_earliest,
            existing_latest=existing_latest,
        )
        if is_fully_covered:
            duration = int((_utcnow() - started).total_seconds())
            io.update_data_ingest_progress(job.id, stage="finalize", progress=95)
            io.save_data_ingest_job_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=0,
                start_date=existing_latest,
                end_date=existing_latest,
            )
            print(
                f"[engine] data_ingest_v2 skipped job={job.id} "
                f"{job.symbol} already current ({existing_latest})"
            )
            return

        print(f"[engine] data_ingest_v2 job={job.id} symbol={job.symbol} {start_date}→{end_date}")
        stage = "download"
        try:
            io.update_data_ingest_progress(job.id, stage=stage, progress=10)

            # Split into year-sized chunks so yfinance never hangs on 10+ year requests.
            year_chunks = _make_year_chunks(start_date, end_date)
            total_chunks = len(year_chunks)
            _fallback_provider = os.getenv("FACTORLAB_FALLBACK_PROVIDER", "").strip().lower()

            all_close_series: list["pd.Series"] = []
            for chunk_idx, (c_start, c_end) in enumerate(year_chunks):
                # Progress: 10% base + up to 55% across all chunks (download phase)
                chunk_pct = 10 + int((chunk_idx / total_chunks) * 55)
                io.update_data_ingest_progress(job.id, stage=stage, progress=chunk_pct)

                raw = _download_data_ingest_with_retry(job.symbol, c_start, c_end)

                # Fallback provider: if primary data is absent/sparse, try stooq.
                # Controlled by FACTORLAB_FALLBACK_PROVIDER=stooq env var.
                if _fallback_provider == "stooq":
                    primary_rows = (
                        0
                        if raw.empty
                        else (
                            len(raw[raw.columns[0]].dropna())
                            if isinstance(raw.columns, pd.MultiIndex)
                            else len(raw.dropna())
                        )
                    )
                    expected_bdays = max(
                        1, int((pd.to_datetime(c_end) - pd.to_datetime(c_start)).days * 5 / 7)
                    )
                    if primary_rows < expected_bdays * 0.5:
                        print(
                            f"[engine] primary sparse ({primary_rows}/{expected_bdays} rows), "
                            f"trying stooq fallback for {job.symbol} {c_start}→{c_end}"
                        )
                        fallback_series = _download_stooq_prices(job.symbol, c_start, c_end)
                        if not fallback_series.empty:
                            if raw.empty:
                                primary_series = pd.Series(dtype=float)
                            else:
                                primary_series = _extract_close_series(raw)
                            merged = primary_series.combine_first(fallback_series)
                            raw = pd.DataFrame({"Close": merged})
                            print(
                                f"[engine] stooq merge: {len(primary_series)} primary + "
                                f"{len(fallback_series) - len(primary_series.reindex(fallback_series.index).dropna())} "
                                f"fallback = {len(raw)} total"
                            )

                if not raw.empty:
                    all_close_series.append(_extract_close_series(raw))

            if not all_close_series:
                duration = int((_utcnow() - started).total_seconds())
                actual = existing_latest or start_date
                io.update_data_ingest_progress(job.id, stage="finalize", progress=95)
                io.save_data_ingest_job_success(
                    job=job,
                    duration_seconds=duration,
                    tickers_updated=1,
                    rows_upserted=0,
                    start_date=actual,
                    end_date=actual,
                )
                print(f"[engine] data_ingest_v2 completed job={job.id} no new rows")
                return

            stage = "transform"
            io.update_data_ingest_progress(job.id, stage=stage, progress=70)
            # Concatenate all year-chunk series, de-duplicate dates, forward-fill
            close_series = pd.concat(all_close_series).sort_index()
            close_series = (
                close_series[~close_series.index.duplicated(keep="last")].ffill().dropna()
            )

            stage = "upsert"
            io.update_data_ingest_progress(job.id, stage=stage, progress=80)
            price_rows: list[dict[str, Any]] = []
            for dt, val in close_series.items():
                if pd.isna(val):
                    continue
                price_rows.append(
                    {
                        "ticker": job.symbol,
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "adj_close": float(val),
                    }
                )

            chunk_size = 5000
            for i in range(0, len(price_rows), chunk_size):
                chunk = price_rows[i : i + chunk_size]
                io.client.table("prices").upsert(chunk, on_conflict="ticker,date").execute()

            stage = "finalize"
            io.update_data_ingest_progress(job.id, stage=stage, progress=95)

            duration = int((_utcnow() - started).total_seconds())
            actual_start = price_rows[0]["date"] if price_rows else start_date
            actual_end = price_rows[-1]["date"] if price_rows else end_date
            io.save_data_ingest_job_success(
                job=job,
                duration_seconds=duration,
                tickers_updated=1,
                rows_upserted=len(price_rows),
                start_date=actual_start,
                end_date=actual_end,
            )
            print(
                f"[engine] data_ingest_v2 completed job={job.id} "
                f"{len(price_rows)} rows in {duration}s"
            )
        except Exception as exc:
            duration = int((_utcnow() - started).total_seconds())
            err_str = f"[stage={stage}] {exc}"
            print(f"[engine] data_ingest_v2 failed job={job.id} in {duration}s: {exc}")
            classification = _classify_ingest_error(str(exc))
            if classification == "blocked":
                io.save_data_ingest_job_blocked(job, duration, err_str, stage=stage)
                print(f"[engine] data_ingest_v2 BLOCKED job={job.id} (permanent): {exc}")
            else:
                io.save_data_ingest_job_failure_with_retry(job, duration, err_str, stage=stage)
