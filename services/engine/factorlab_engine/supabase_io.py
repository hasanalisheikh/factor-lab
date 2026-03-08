from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import pandas as pd
from supabase import Client, create_client


@dataclass(frozen=True)
class Job:
  id: str
  run_id: str | None  # None for data_ingest jobs
  name: str
  stage: str | None = None
  job_type: str = "backtest"
  payload: dict | None = None


class SupabaseIO:
  def __init__(self) -> None:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
      raise RuntimeError(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      )
    self.client: Client = create_client(url, key)

  def fetch_queued_jobs(self, limit: int = 3) -> list[Job]:
    result = (
      self.client.table("jobs")
      .select("id,run_id,name,stage,job_type,payload")
      .eq("status", "queued")
      .order("created_at")
      .limit(limit)
      .execute()
    )
    rows = result.data or []
    jobs: list[Job] = []
    for row in rows:
      job_type = row.get("job_type", "backtest")
      run_id = row.get("run_id")
      # Backtest jobs must have a run_id; skip orphaned rows
      if job_type == "backtest" and not run_id:
        continue
      jobs.append(
        Job(
          id=row["id"],
          run_id=run_id,
          name=row["name"],
          stage=row.get("stage"),
          job_type=job_type,
          payload=row.get("payload"),
        )
      )
    return jobs

  def claim_job(self, job: Job) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    claim_payload = {
      "status": "running",
      "stage": "ingest",
      "progress": 5,
      "started_at": now,
      "finished_at": None,
      "error_message": None,
    }
    try:
      claimed = (
        self.client.table("jobs")
        .update(claim_payload)
        .eq("id", job.id)
        .eq("status", "queued")
        .execute()
      )
    except Exception as exc:
      # Backward compat: older schemas may not have jobs.finished_at yet.
      if "finished_at" not in str(exc).lower():
        raise
      claim_payload.pop("finished_at", None)
      claimed = (
        self.client.table("jobs")
        .update(claim_payload)
        .eq("id", job.id)
        .eq("status", "queued")
        .execute()
      )
    if not (claimed.data or []):
      return False

    # Only update run status for backtest jobs that have a run_id
    if job.run_id:
      (
        self.client.table("runs")
        .update({"status": "running"})
        .eq("id", job.run_id)
        .eq("status", "queued")
        .execute()
      )
    return True

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
    (
      self.client.table("runs")
      .update({"universe_symbols": symbols})
      .eq("id", run_id)
      .execute()
    )

  def update_run_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:
    (
      self.client.table("runs")
      .update({"run_metadata": metadata})
      .eq("id", run_id)
      .execute()
    )

  def _update_job_row(
    self,
    job_id: str,
    values: dict[str, Any],
    *,
    fallback_stage: str | None = None,
  ) -> Any:
    """Update a jobs row with light backward-compat fallbacks.

    Handles two migration-drift cases:
    - `finished_at` column not present yet.
    - data-ingest custom stage not allowed by legacy jobs_stage_check.
    """
    payload = dict(values)
    for _ in range(3):
      try:
        return (
          self.client.table("jobs")
          .update(payload)
          .eq("id", job_id)
          .execute()
        )
      except Exception as exc:
        message = str(exc).lower()
        retried = False
        if "finished_at" in payload and "finished_at" in message:
          payload.pop("finished_at", None)
          retried = True
        if fallback_stage and "stage" in payload and "stage" in message:
          if payload.get("stage") != fallback_stage:
            payload["stage"] = fallback_stage
            retried = True
        if not retried:
          raise
    raise RuntimeError("jobs update failed after fallback retries")

  def update_job_progress(self, job_id: str, *, stage: str, progress: int) -> None:
    bounded = max(0, min(int(progress), 100))
    # Map newer stage names to a fallback that older DB schemas will accept.
    # Fallback is used when the jobs_stage_check constraint rejects the value
    # (i.e., the 20260307_jobs_stage_backtest_detail.sql migration hasn't run yet).
    _data_ingest_stages = {"download", "transform", "upsert_prices"}
    _early_backtest_stages = {"load_data"}
    _mid_backtest_stages = {"compute_signals", "rebalance", "metrics"}
    _late_backtest_stages = {"persist"}
    if stage in _data_ingest_stages:
      fallback_stage = "ingest"
    elif stage in _early_backtest_stages:
      fallback_stage = "ingest"
    elif stage in _mid_backtest_stages:
      fallback_stage = "backtest"
    elif stage in _late_backtest_stages:
      fallback_stage = "report"
    else:
      fallback_stage = "report"
    self._update_job_row(
      job_id,
      {"stage": stage, "progress": bounded},
      fallback_stage=fallback_stage,
    )

  def fetch_prices_frame(
    self, tickers: list[str], start_date: str, end_date: str
  ) -> pd.DataFrame:
    if not tickers:
      return pd.DataFrame()

    result = (
      self.client.table("prices")
      .select("ticker,date,adj_close")
      .in_("ticker", tickers)
      .gte("date", start_date)
      .lte("date", end_date)
      .order("date")
      .execute()
    )
    rows = result.data or []
    if not rows:
      return pd.DataFrame()

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"], utc=False)
    pivot = frame.pivot(index="date", columns="ticker", values="adj_close")
    return pivot.sort_index().ffill().dropna(how="all")

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
    (
      self.client.table("runs")
      .update({"status": "completed"})
      .eq("id", job.run_id)
      .execute()
    )

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
      (
        self.client.table("runs")
        .update({"status": "failed"})
        .eq("id", job.run_id)
        .execute()
      )

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

  def _replace_equity_curve(
    self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
  ) -> None:
    self.client.table("equity_curve").delete().eq("run_id", run_id).execute()
    if not rows:
      return
    for start in range(0, len(rows), chunk_size):
      chunk = rows[start : start + chunk_size]
      self.client.table("equity_curve").insert(chunk).execute()

  def _upsert_metrics(self, run_id: str, metrics: dict[str, float]) -> None:
    payload = {
      "run_id": run_id,
      "cagr": metrics["cagr"],
      "sharpe": metrics["sharpe"],
      "max_drawdown": metrics["max_drawdown"],
      "turnover": metrics["turnover"],
      "volatility": metrics["volatility"],
      "win_rate": metrics["win_rate"],
      "profit_factor": metrics["profit_factor"],
      "calmar": metrics["calmar"],
    }
    self.client.table("run_metrics").upsert(payload, on_conflict="run_id").execute()

  def _upsert_features_monthly(
    self, rows: list[dict[str, Any]], chunk_size: int = 500
  ) -> None:
    if not rows:
      return
    for start in range(0, len(rows), chunk_size):
      chunk = rows[start : start + chunk_size]
      self.client.table("features_monthly").upsert(
        chunk,
        on_conflict="ticker,date",
      ).execute()

  def _replace_model_predictions(
    self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
  ) -> None:
    self.client.table("model_predictions").delete().eq("run_id", run_id).execute()
    if not rows:
      return
    for start in range(0, len(rows), chunk_size):
      chunk = rows[start : start + chunk_size]
      self.client.table("model_predictions").insert(chunk).execute()

  def _replace_positions(
    self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
  ) -> None:
    self.client.table("positions").delete().eq("run_id", run_id).execute()
    if not rows:
      return
    for start in range(0, len(rows), chunk_size):
      chunk = rows[start : start + chunk_size]
      self.client.table("positions").insert(chunk).execute()

  def _replace_model_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:
    self.client.table("model_metadata").delete().eq("run_id", run_id).execute()
    self.client.table("model_metadata").insert([metadata]).execute()
