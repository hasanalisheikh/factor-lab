from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable

import pandas as pd

if TYPE_CHECKING:
    from factorlab_engine.supabase_io import SupabaseIO


# ---------------------------------------------------------------------------
# Job-level wall-clock timeout (prevents stuck/runaway jobs)
# ---------------------------------------------------------------------------
_JOB_TIMEOUT_SECONDS: int = int(os.getenv("JOB_TIMEOUT_SECONDS", "600"))  # 10 min
_ML_RIDGE_JOB_TIMEOUT_SECONDS: int = int(
    os.getenv("JOB_TIMEOUT_SECONDS_ML_RIDGE", str(max(_JOB_TIMEOUT_SECONDS, 900)))
)
_ML_LIGHTGBM_JOB_TIMEOUT_SECONDS: int = int(
    os.getenv("JOB_TIMEOUT_SECONDS_ML_LIGHTGBM", str(max(_JOB_TIMEOUT_SECONDS, 1800)))
)
# Separate budget for the persistence phase (save_success DB writes) after the compute
# timeout has been cancelled. Keeps persistence bounded without constraining computation.
_PERSIST_TIMEOUT_SECONDS: int = int(os.getenv("PERSIST_TIMEOUT_SECONDS", "600"))  # 10 min

ProgressCallback = Callable[[str, int], None]

DEFAULT_ETF8_UNIVERSE = ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utc_today_str() -> str:
    return _utcnow().strftime("%Y-%m-%d")


def _job_timeout_seconds_for_strategy(strategy_id: str) -> int:
    if strategy_id == "ml_lightgbm":
        return _ML_LIGHTGBM_JOB_TIMEOUT_SECONDS
    if strategy_id == "ml_ridge":
        return _ML_RIDGE_JOB_TIMEOUT_SECONDS
    return _JOB_TIMEOUT_SECONDS


# ---------------------------------------------------------------------------
# Backtest window requirements
# ---------------------------------------------------------------------------
MIN_SPAN_DAYS: int = 730  # 2 calendar years
MIN_DATA_POINTS: int = 500  # ~2 years of daily trading data

# ---------------------------------------------------------------------------
# Strategy-specific constants
# ---------------------------------------------------------------------------
_LOW_VOL_WINDOW: int = 60  # 60 trading-day realized vol window
_TREND_SMA_WINDOW: int = 200  # 200-day benchmark SMA for trend signal
_TREND_DEFENSIVE: str = "TLT"  # Primary risk-off asset
_TREND_DEFENSIVE_FALLBACK: str = "BIL"  # Cash-proxy fallback

# Sentinel symbol written to the positions table for rebalance dates where a strategy
# holds no risky assets (e.g. momentum_12_1 with all-negative scores).  Weight is 0.0.
# Consumers MUST filter this symbol out before treating rows as real ticker holdings.
_ALL_CASH_SENTINEL: str = "_CASH"

# Data-ingest safeguards
_INGEST_HTTP_TIMEOUT_SECONDS: int = 25
_INGEST_ATTEMPT_TIMEOUT_SECONDS: int = 45
_INGEST_MAX_RETRIES: int = 3
_INGEST_BACKOFF_SECONDS: tuple[int, ...] = (1, 2, 4)
_ML_SNAPSHOT_MODE = "db_only_strict_v1"

# Static preset baskets used for run-level reproducibility. These can be updated
# later without changing the resolution precedence contract.
UNIVERSE_PRESETS: dict[str, list[str]] = {
    "ETF8": DEFAULT_ETF8_UNIVERSE,
    "SP100": [
        "AAPL",
        "MSFT",
        "AMZN",
        "GOOGL",
        "GOOG",
        "META",
        "NVDA",
        "BRK-B",
        "JPM",
        "XOM",
        "UNH",
        "JNJ",
        "PG",
        "V",
        "MA",
        "HD",
        "COST",
        "ABBV",
        "PEP",
        "MRK",
    ],
    "NASDAQ100": [
        "AAPL",
        "MSFT",
        "NVDA",
        "AMZN",
        "META",
        "GOOGL",
        "GOOG",
        "AVGO",
        "COST",
        "TSLA",
        "NFLX",
        "AMD",
        "ADBE",
        "CSCO",
        "PEP",
        "INTC",
        "QCOM",
        "AMGN",
        "TXN",
        "CMCSA",
    ],
}


@dataclass(frozen=True)
class BacktestResult:
    equity_rows: list[dict[str, Any]]
    metrics: dict[str, float]
    feature_rows: list[dict[str, Any]] | None = None
    prediction_rows: list[dict[str, Any]] | None = None
    model_metadata: dict[str, Any] | None = None
    position_rows: list[dict[str, Any]] | None = None
    run_audit_metadata: dict[str, Any] | None = None


def validate_backtest_window(
    dates: list[Any],
    min_span_days: int = MIN_SPAN_DAYS,
    min_data_points: int = MIN_DATA_POINTS,
) -> tuple[bool, str]:
    """Validate that a backtest has sufficient history.

    Checks:
      - At least ``min_data_points`` data points (default 500, ~2 yr daily).
      - At least ``min_span_days`` calendar days between first and last date
        (default 730, 2 years).

    Detects monthly-cadence data (median inter-date gap > 20 days) and adjusts
    the count-failure message to note that the 500-point guideline targets daily
    data.

    Returns:
      (ok, reason): ok=True when all checks pass; reason is empty on success.
    """
    n = len(dates)
    if n == 0:
        return False, (
            "No data points produced. Ensure data coverage for the requested date range."
        )

    ts_dates = sorted(pd.Timestamp(d) for d in dates)
    span_days = (ts_dates[-1] - ts_dates[0]).days if n >= 2 else 0

    # Detect daily vs monthly cadence from median inter-date gap.
    is_monthly = False
    if n >= 4:
        gaps = [(ts_dates[i] - ts_dates[i - 1]).days for i in range(1, min(n, 11))]
        median_gap = sorted(gaps)[len(gaps) // 2]
        is_monthly = median_gap > 20

    if n < min_data_points:
        cadence_note = (
            (
                f" Note: the {min_data_points}-point guideline applies to daily data; "
                "monthly backtests require a much longer time span to accumulate that many observations."
            )
            if is_monthly
            else ""
        )
        return False, (
            f"Insufficient data: {n} data points (need >= {min_data_points}).{cadence_note} "
            "Choose a longer date range or ensure data ingestion coverage."
        ).strip()

    if span_days < min_span_days:
        return False, (
            f"Backtest span is {span_days} days ({span_days / 365:.1f} years), "
            f"but at least {min_span_days} days (2 years) are required for a robust backtest. "
            "Choose an earlier start date or extend your date range."
        )

    return True, ""


def _to_date(value: str) -> pd.Timestamp:
    ts = pd.to_datetime(value, utc=False)
    return pd.Timestamp(ts.date())


def _subtract_calendar_days(value: str, days: int) -> str:
    if days <= 0:
        return value
    return (pd.to_datetime(value) - pd.Timedelta(days=days)).strftime("%Y-%m-%d")


def _baseline_warmup_calendar_days(strategy_id: str) -> int:
    if strategy_id == "momentum_12_1":
        return 390
    if strategy_id == "low_vol":
        return 90
    if strategy_id == "trend_filter":
        # Trend Filter needs both the benchmark SMA warmup and the risk-on momentum lookback.
        return 390
    return 0


def _normalize_symbol_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = values.split(",")
    if not isinstance(values, (list, tuple)):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        symbol = str(raw).strip().upper()
        if not symbol or symbol in seen:
            continue
        normalized.append(symbol)
        seen.add(symbol)
    return normalized


def _extract_run_universe_preset(run: dict[str, Any]) -> str | None:
    universe = run.get("universe")
    if isinstance(universe, str) and universe.strip():
        return universe.strip().upper()

    run_params = run.get("run_params")
    if isinstance(run_params, dict):
        nested = run_params.get("universe")
        if isinstance(nested, str) and nested.strip():
            return nested.strip().upper()
    return None


def resolve_universe_symbols(run: dict[str, Any]) -> list[str]:
    snapshot_symbols = _normalize_symbol_list(run.get("universe_symbols"))
    if snapshot_symbols:
        return snapshot_symbols

    preset_name = _extract_run_universe_preset(run)
    if preset_name and preset_name in UNIVERSE_PRESETS:
        return list(UNIVERSE_PRESETS[preset_name])

    env_value = (os.getenv("FACTORLAB_UNIVERSE") or "").strip()
    if env_value:
        env_key = env_value.upper()
        if env_key in UNIVERSE_PRESETS:
            return list(UNIVERSE_PRESETS[env_key])
        env_symbols = _normalize_symbol_list(env_value)
        if env_symbols:
            return env_symbols

    return list(DEFAULT_ETF8_UNIVERSE)


def resolve_and_snapshot_universe_symbols(io: SupabaseIO, run: dict[str, Any]) -> list[str]:
    symbols = resolve_universe_symbols(run)
    if not _normalize_symbol_list(run.get("universe_symbols")):
        io.update_run_universe_symbols(run["id"], symbols)
        run["universe_symbols"] = list(symbols)
    return symbols
