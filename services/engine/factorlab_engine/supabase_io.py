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
  run_id: str
  name: str


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
      .select("id,run_id,name")
      .eq("status", "queued")
      .not_.is_("run_id", "null")
      .order("created_at")
      .limit(limit)
      .execute()
    )
    rows = result.data or []
    jobs: list[Job] = []
    for row in rows:
      run_id = row.get("run_id")
      if run_id:
        jobs.append(Job(id=row["id"], run_id=run_id, name=row["name"]))
    return jobs

  def claim_job(self, job: Job) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    claimed = (
      self.client.table("jobs")
      .update({"status": "running", "progress": 5, "started_at": now})
      .eq("id", job.id)
      .eq("status", "queued")
      .execute()
    )
    if not (claimed.data or []):
      return False

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
      .select("id,name,strategy_id,status,start_date,end_date")
      .eq("id", run_id)
      .maybe_single()
      .execute()
    )
    return result.data

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
  ) -> None:
    rows = list(equity_rows)
    self._replace_equity_curve(job.run_id, rows)
    self._upsert_metrics(job.run_id, metrics)
    if feature_rows:
      self._upsert_features_monthly(feature_rows)
    if prediction_rows is not None:
      self._replace_model_predictions(job.run_id, prediction_rows)
    if model_metadata is not None:
      self._upsert_model_metadata(model_metadata)

    (
      self.client.table("jobs")
      .update(
        {"status": "completed", "progress": 100, "duration": max(duration_seconds, 0)}
      )
      .eq("id", job.id)
      .execute()
    )
    (
      self.client.table("runs")
      .update({"status": "completed"})
      .eq("id", job.run_id)
      .execute()
    )

  def save_failure(self, job: Job, duration_seconds: int, error_message: str) -> None:
    message = error_message[:400]
    (
      self.client.table("jobs")
      .update(
        {
          "status": "failed",
          "duration": max(duration_seconds, 0),
          "progress": 100,
          "name": f"{job.name} (failed: {message})",
        }
      )
      .eq("id", job.id)
      .execute()
    )
    (
      self.client.table("runs")
      .update({"status": "failed"})
      .eq("id", job.run_id)
      .execute()
    )

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

  def _upsert_model_metadata(self, metadata: dict[str, Any]) -> None:
    self.client.table("model_metadata").upsert(
      metadata,
      on_conflict="run_id",
    ).execute()
