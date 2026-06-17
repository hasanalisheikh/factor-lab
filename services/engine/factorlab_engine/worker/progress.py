from __future__ import annotations

import hashlib
import json
import threading
from typing import Any, Callable

import numpy as np
import pandas as pd

from .settings import _ML_SNAPSHOT_MODE, BacktestResult


class _Heartbeat:
    """Background daemon thread that calls a heartbeat function every `interval` seconds."""

    def __init__(
        self,
        beat_fn: Callable[[], None],
        interval: int = 15,
        *,
        job_id: str = "",
    ) -> None:
        self._beat_fn = beat_fn
        self._interval = interval
        self._job_id = job_id
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "_Heartbeat":
        def _run() -> None:
            while not self._stop.wait(timeout=self._interval):
                try:
                    self._beat_fn()
                except Exception:
                    pass

        name = f"heartbeat-{self._job_id[:8]}" if self._job_id else "heartbeat"
        self._thread = threading.Thread(target=_run, daemon=True, name=name)
        self._thread.start()
        return self

    def __exit__(self, *args: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval + 2)


def _apply_rebalance_costs(
    returns: pd.Series, rebalance_turnover: pd.Series, costs_bps: float
) -> pd.Series:
    cost_rate = max(float(costs_bps), 0.0) / 10_000.0
    if cost_rate <= 0:
        return returns

    aligned = rebalance_turnover.reindex(returns.index).fillna(0.0)
    net = returns.copy()
    for dt, t in aligned.items():
        if t > 0:
            net.at[dt] = float(net.at[dt]) - cost_rate * float(t)
    return net


def _compute_metrics(daily_returns: pd.Series, turnover: float) -> dict[str, float]:
    daily_returns = daily_returns.replace([np.inf, -np.inf], np.nan).dropna()
    if daily_returns.empty:
        raise ValueError("No returns available")

    mean_daily = float(daily_returns.mean())
    vol_daily = float(daily_returns.std(ddof=0))
    volatility = vol_daily * np.sqrt(252.0)
    sharpe = (mean_daily / vol_daily) * np.sqrt(252.0) if vol_daily > 1e-10 else 0.0

    equity = (1.0 + daily_returns).cumprod()
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    max_drawdown = float(drawdown.min())

    n = len(daily_returns)
    cagr = float(equity.iloc[-1] ** (252.0 / n) - 1.0) if n > 0 else 0.0
    calmar = cagr / abs(max_drawdown) if max_drawdown < 0 else 0.0
    win_rate = float((daily_returns > 0).mean())

    gains = float(daily_returns[daily_returns > 0].sum())
    losses = float(abs(daily_returns[daily_returns < 0].sum()))
    profit_factor = gains / losses if losses > 0 else 0.0

    return {
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown,
        "turnover": float(turnover),
        "volatility": volatility,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "calmar": calmar,
    }


def _equity_rows(
    dates: pd.Index, portfolio: pd.Series, benchmark: pd.Series
) -> list[dict[str, Any]]:
    aligned_dates = (
        pd.Index(dates).intersection(portfolio.index).intersection(benchmark.index).sort_values()
    )
    rows: list[dict[str, Any]] = []
    for dt in aligned_dates:
        rows.append(
            {
                "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                "portfolio": float(portfolio.loc[dt]),
                "benchmark": float(benchmark.loc[dt]),
            }
        )
    return rows


def _rows_digest(rows: list[dict[str, Any]] | None, *, keys: list[str]) -> str | None:
    if not rows:
        return None
    normalized: list[dict[str, Any]] = []
    for row in rows:
        normalized.append({k: row.get(k) for k in keys})
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_iso_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    except Exception:
        return None


def _read_run_preflight_snapshot(run: dict[str, Any]) -> dict[str, Any]:
    run_params = run.get("run_params")
    if not isinstance(run_params, dict):
        return {}
    preflight = run_params.get("preflight")
    return preflight if isinstance(preflight, dict) else {}


def _read_initial_capital(run: dict[str, Any], default: float = 100_000.0) -> float:
    """Return configured initial_capital from run_params, falling back to *default*.

    Falls back silently so that old run rows that pre-date the initial_capital field
    continue to produce equity curves starting at $100,000 unchanged.
    """
    run_params = run.get("run_params")
    if isinstance(run_params, dict):
        val = run_params.get("initial_capital")
        if isinstance(val, (int, float)) and float(val) > 0:
            return float(val)
    return default


def _ml_required_snapshot_cutoff(run: dict[str, Any]) -> str:
    preflight = _read_run_preflight_snapshot(run)
    return (
        _read_iso_date(preflight.get("required_end"))
        or _read_iso_date(run.get("end_date"))
        or str(run["end_date"])
    )


def _price_frame_snapshot_digest(frame: pd.DataFrame) -> str | None:
    if frame.empty:
        return None
    normalized = frame.sort_index().reindex(sorted(str(c) for c in frame.columns), axis=1)
    flattened: list[dict[str, Any]] = []
    for dt in normalized.index:
        date_str = pd.Timestamp(dt).strftime("%Y-%m-%d")
        for ticker in normalized.columns:
            value = normalized.at[dt, ticker]
            flattened.append(
                {
                    "date": date_str,
                    "ticker": str(ticker),
                    "adj_close": (None if pd.isna(value) else float(value)),
                }
            )
    payload = json.dumps(flattened, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_price_snapshot_metadata(
    frame: pd.DataFrame,
    *,
    required_cutoff: str,
) -> dict[str, Any]:
    if frame.empty:
        return {
            "data_snapshot_digest": None,
            "data_snapshot_start": None,
            "data_snapshot_end": None,
            "data_snapshot_cutoff": required_cutoff,
            "data_snapshot_rows": 0,
            "data_snapshot_tickers": 0,
            "data_snapshot_mode": _ML_SNAPSHOT_MODE,
            "runtime_download_used": False,
        }

    return {
        "data_snapshot_digest": _price_frame_snapshot_digest(frame),
        "data_snapshot_start": pd.Timestamp(frame.index.min()).strftime("%Y-%m-%d"),
        "data_snapshot_end": pd.Timestamp(frame.index.max()).strftime("%Y-%m-%d"),
        "data_snapshot_cutoff": required_cutoff,
        "data_snapshot_rows": int(frame.shape[0] * frame.shape[1]),
        "data_snapshot_tickers": int(frame.shape[1]),
        "data_snapshot_mode": _ML_SNAPSHOT_MODE,
        "runtime_download_used": False,
    }


def _validate_ml_snapshot_prices(
    prices: pd.DataFrame,
    *,
    required_tickers: list[str],
    required_cutoff: str,
) -> None:
    failures: list[str] = []
    available_columns = {str(c) for c in prices.columns}
    missing_tickers = sorted(
        {ticker for ticker in required_tickers if ticker not in available_columns}
    )
    if missing_tickers:
        failures.append(f"missing_tickers={missing_tickers}")

    required_cutoff_ts = pd.Timestamp(required_cutoff)
    if prices.empty:
        failures.append("prices_frame=empty")
    elif required_cutoff_ts not in prices.index:
        max_date = pd.Timestamp(prices.index.max()).strftime("%Y-%m-%d")
        failures.append(
            f"required_cutoff={required_cutoff} missing_from_frame (max_date={max_date})"
        )
    else:
        uncovered = sorted(
            {
                ticker
                for ticker in required_tickers
                if ticker in available_columns and pd.isna(prices.at[required_cutoff_ts, ticker])
            }
        )
        if uncovered:
            failures.append(f"null_at_required_cutoff={uncovered}")

    if failures:
        raise RuntimeError(
            "ML reproducibility guard: queued snapshot unavailable in DB. "
            + "; ".join(failures)
            + ". Runtime price downloads are disabled for ML runs."
        )


def _validate_backtest_result(result: BacktestResult, run_id: str) -> None:
    """Raise RuntimeError if any required output is missing.

    Prevents a run from being marked 'completed' when the DB would be left in a
    partially-written state (e.g. missing metrics, empty equity curve, no positions).
    """
    missing: list[str] = []

    if not result.equity_rows:
        missing.append("equity_curve (no rows produced)")
    else:
        has_benchmark = any(row.get("benchmark") is not None for row in result.equity_rows)
        if not has_benchmark:
            missing.append("equity_curve.benchmark (all benchmark values are null)")

    if not result.position_rows:
        missing.append("positions (no rebalance rows produced)")

    required_keys = {
        "cagr",
        "sharpe",
        "max_drawdown",
        "turnover",
        "volatility",
        "win_rate",
        "profit_factor",
        "calmar",
    }
    if not result.metrics:
        missing.append("metrics (empty)")
    else:
        absent = required_keys - set(result.metrics.keys())
        if absent:
            missing.append(f"metrics missing keys: {sorted(absent)}")

    if missing:
        raise RuntimeError(
            f"[run={run_id}] Backtest finished but required outputs are missing: "
            + ", ".join(missing)
            + ". Run marked failed to prevent silent data loss."
        )


def _build_run_metadata(run: dict[str, Any], result: BacktestResult) -> dict[str, Any]:
    strategy = str(run.get("strategy_id", ""))
    model_metadata = result.model_metadata or {}
    model_params = model_metadata.get("model_params", {})
    if not isinstance(model_params, dict):
        model_params = {}
    audit_metadata = (
        result.run_audit_metadata if isinstance(result.run_audit_metadata, dict) else {}
    )
    requested_model_impl: str | None = None
    if strategy == "ml_ridge":
        requested_model_impl = "ridge"
    elif strategy == "ml_lightgbm":
        requested_model_impl = "lightgbm"

    model_impl = str(model_params.get("model_impl") or requested_model_impl or "n/a")
    train_start = model_metadata.get("train_start")
    train_end = model_metadata.get("train_end")
    feature_set = model_params.get("feature_set")
    deterministic_model_params = model_params.get("deterministic_model_params")

    metadata = {
        "strategy_requested": strategy,
        "model_impl": model_impl,
        "model_name": str(model_metadata.get("model_name") or strategy),
        "model_version": model_params.get("model_version"),
        "feature_set": feature_set,
        "random_seed": (
            model_params.get("random_seed") if requested_model_impl is not None else None
        ),
        "determinism_mode": model_params.get("determinism_mode"),
        "lightgbm_version": model_params.get("lightgbm_version"),
        "deterministic_model_params": (
            deterministic_model_params if isinstance(deterministic_model_params, dict) else None
        ),
        "training_window": {
            "start": train_start,
            "end": train_end,
            "min_train_months": (
                model_params.get("training_window", {}).get("min_train_months")
                if isinstance(model_params.get("training_window"), dict)
                else None
            ),
        },
        "positions_digest": _rows_digest(
            result.position_rows,
            keys=["date", "symbol", "weight"],
        ),
        "predictions_digest": _rows_digest(
            result.prediction_rows,
            keys=[
                "as_of_date",
                "target_date",
                "ticker",
                "predicted_return",
                "realized_return",
                "rank",
                "selected",
                "weight",
            ],
        ),
        "equity_digest": _rows_digest(
            result.equity_rows,
            keys=["date", "portfolio", "benchmark"],
        ),
    }
    metadata.update(audit_metadata)
    return metadata
