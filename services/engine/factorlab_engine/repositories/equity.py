from __future__ import annotations

from typing import Any


class EquityRepositoryMixin:
    def _replace_equity_curve(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("equity_curve").delete().eq("run_id", run_id).execute(),
            context=f"delete_equity_curve run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("equity_curve").insert(chunk).execute(),
                context=f"insert_equity_curve run_id={run_id} rows={len(chunk)} offset={start}",
            )

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
        self._execute_with_retry(
            lambda: (
                self.client.table("run_metrics").upsert(payload, on_conflict="run_id").execute()
            ),
            context=f"upsert_run_metrics run_id={run_id}",
        )

    def _upsert_features_monthly(self, rows: list[dict[str, Any]], chunk_size: int = 500) -> None:
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: (
                    self.client.table("features_monthly")
                    .upsert(
                        chunk,
                        on_conflict="ticker,date",
                    )
                    .execute()
                ),
                context=f"upsert_features_monthly rows={len(chunk)} offset={start}",
            )

    def _replace_model_predictions(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("model_predictions").delete().eq("run_id", run_id).execute(),
            context=f"delete_model_predictions run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("model_predictions").insert(chunk).execute(),
                context=(
                    f"insert_model_predictions run_id={run_id} rows={len(chunk)} offset={start}"
                ),
            )

    def _replace_positions(
        self, run_id: str, rows: list[dict[str, Any]], chunk_size: int = 500
    ) -> None:
        self._execute_with_retry(
            lambda: self.client.table("positions").delete().eq("run_id", run_id).execute(),
            context=f"delete_positions run_id={run_id}",
        )
        if not rows:
            return
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            self._execute_with_retry(
                lambda chunk=chunk: self.client.table("positions").insert(chunk).execute(),
                context=f"insert_positions run_id={run_id} rows={len(chunk)} offset={start}",
            )

    def _replace_model_metadata(self, run_id: str, metadata: dict[str, Any]) -> None:
        self._execute_with_retry(
            lambda: self.client.table("model_metadata").delete().eq("run_id", run_id).execute(),
            context=f"delete_model_metadata run_id={run_id}",
        )
        self._execute_with_retry(
            lambda: self.client.table("model_metadata").insert([metadata]).execute(),
            context=f"insert_model_metadata run_id={run_id}",
        )
