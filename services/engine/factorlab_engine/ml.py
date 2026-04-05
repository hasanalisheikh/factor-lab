from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .turnover import annualize_turnover_from_position_rows, one_way_turnover

# ---------------------------------------------------------------------------
# Feature columns — daily, leakage-safe
# ---------------------------------------------------------------------------
FEATURE_COLUMNS = [
    "mom_5d",
    "mom_20d",
    "mom_60d",
    "mom_252d",
    "vol_20d",
    "vol_60d",
    "drawdown_252d",
    "beta_60d",
]
ML_RANDOM_SEED = 0
LIGHTGBM_DETERMINISM_MODE = "strict_same_deployment_v1"


@dataclass(frozen=True)
class MLArtifacts:
    equity_rows: list[dict[str, Any]]
    metrics: dict[str, float]
    feature_rows: list[dict[str, Any]]
    prediction_rows: list[dict[str, Any]]
    metadata: dict[str, Any]
    position_rows: list[dict[str, Any]]


def _compute_metrics(returns: pd.Series, turnover: float) -> dict[str, float]:
    """Compute annualised performance metrics from a daily returns series."""
    clean = returns.replace([np.inf, -np.inf], np.nan).dropna()
    if clean.empty:
        raise ValueError("No returns available for ML metrics")

    mean_period = float(clean.mean())
    vol_period = float(clean.std(ddof=0))
    ann_factor = np.sqrt(252.0)  # daily annualisation
    volatility = vol_period * ann_factor
    sharpe = (mean_period / vol_period) * ann_factor if vol_period > 0 else 0.0

    equity = (1.0 + clean).cumprod()
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    max_drawdown = float(drawdown.min())

    n = len(clean)
    cagr = float(equity.iloc[-1] ** (252.0 / n) - 1.0) if n > 0 else 0.0
    calmar = cagr / abs(max_drawdown) if max_drawdown < 0 else 0.0
    win_rate = float((clean > 0).mean())

    gains = float(clean[clean > 0].sum())
    losses = float(abs(clean[clean < 0].sum()))
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


def compute_daily_features(prices: pd.DataFrame, benchmark_ticker: str) -> pd.DataFrame:
    """Build a long-format feature DataFrame: one row per (date, non-benchmark symbol).

    All features use only price data up to date t — no lookahead.
    Target y = next-day return: close(t+1) / close(t) - 1  (shift(-1) of daily_ret).

    The dataset is kept in LONG format.  Symbols missing features on a given date
    simply produce NaN on that row; they are dropped per-row later, NOT by requiring
    every symbol to have data on the same date (which would inner-join away rows).
    """
    prices = prices.sort_index().ffill().dropna(how="all")
    daily_ret = prices.pct_change()

    # ── Momentum features (vectorized over all columns) ─────────────────────
    mom_5d = prices / prices.shift(5) - 1.0
    mom_20d = prices / prices.shift(20) - 1.0
    mom_60d = prices / prices.shift(60) - 1.0
    mom_252d = prices / prices.shift(252) - 1.0

    # ── Volatility ────────────────────────────────────────────────────────────
    vol_20d = daily_ret.rolling(20).std(ddof=0)
    vol_60d = daily_ret.rolling(60).std(ddof=0)

    # ── Max-drawdown over trailing 252 trading days ───────────────────────────
    drawdown_252d = prices / prices.rolling(252).max() - 1.0

    # ── Rolling beta vs benchmark (vectorized — no per-ticker Python loop) ────
    bench_ret = daily_ret[benchmark_ticker]
    bench_var = bench_ret.rolling(60).var()
    # Compute cov of every column with benchmark simultaneously
    cov_matrix = daily_ret.rolling(60).cov(bench_ret)  # type: ignore[arg-type]
    beta_60d = cov_matrix.div(bench_var, axis=0).replace([np.inf, -np.inf], np.nan)

    # ── Target: next-day return ───────────────────────────────────────────────
    target_return = daily_ret.shift(-1)
    benchmark_return = target_return[benchmark_ticker]

    # ── Stack wide DataFrames to long format ──────────────────────────────────
    portfolio_tickers = [t for t in prices.columns if t != benchmark_ticker]
    if not portfolio_tickers:
        return pd.DataFrame()

    frames: list[pd.DataFrame] = []
    for ticker in portfolio_tickers:
        df = pd.DataFrame(
            {
                "date": prices.index,
                "ticker": ticker,
                "mom_5d": mom_5d[ticker].to_numpy(),
                "mom_20d": mom_20d[ticker].to_numpy(),
                "mom_60d": mom_60d[ticker].to_numpy(),
                "mom_252d": mom_252d[ticker].to_numpy(),
                "vol_20d": vol_20d[ticker].to_numpy(),
                "vol_60d": vol_60d[ticker].to_numpy(),
                "drawdown_252d": drawdown_252d[ticker].to_numpy(),
                "beta_60d": beta_60d[ticker].to_numpy(),
                "target_return": target_return[ticker].to_numpy(),
                "benchmark_return": benchmark_return.to_numpy(),
            }
        )
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


def _build_model(strategy: str):
    if strategy == "ml_ridge":
        return make_pipeline(StandardScaler(), Ridge(alpha=1.0, random_state=ML_RANDOM_SEED))

    if strategy == "ml_lightgbm":
        try:
            from lightgbm import LGBMRegressor  # noqa: PLC0415
        except (ImportError, OSError) as exc:
            raise RuntimeError(
                "ml_lightgbm requires LightGBM and its native OpenMP library to be "
                "installed. No silent fallback will occur. "
                "Install with: pip install 'lightgbm>=4.5.0' and on macOS run: "
                "brew install libomp. "
                f"Original error: {exc}"
            ) from exc
        # Fewer estimators for daily refits (refit ~252×/year vs ~12× monthly)
        return LGBMRegressor(
            n_estimators=200,
            learning_rate=0.05,
            num_leaves=31,
            min_child_samples=10,
            verbose=-1,
            **_lightgbm_deterministic_params(),
        )

    raise ValueError(f"Unsupported ML strategy: {strategy}")


def _model_impl_for_strategy(strategy: str) -> str:
    if strategy == "ml_ridge":
        return "ridge"
    if strategy == "ml_lightgbm":
        return "lightgbm"
    raise ValueError(f"Unsupported ML strategy: {strategy}")


def _feature_importance(model: Any, feature_names: list[str]) -> dict[str, float]:
    estimator = model
    if hasattr(model, "named_steps"):
        estimator = model.named_steps.get("ridge", model)

    values: np.ndarray | None = None
    if hasattr(estimator, "coef_"):
        coef = np.asarray(estimator.coef_, dtype=float)
        values = np.abs(coef)
    elif hasattr(estimator, "feature_importances_"):
        values = np.asarray(estimator.feature_importances_, dtype=float)

    if values is None or values.size != len(feature_names):
        return {name: 0.0 for name in feature_names}

    denom = float(values.sum())
    if denom <= 0:
        return {name: 0.0 for name in feature_names}
    return {name: float(values[i] / denom) for i, name in enumerate(feature_names)}


def _feature_matrix(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep feature names attached across fit/predict for sklearn-compatible models."""
    return frame.loc[:, FEATURE_COLUMNS]


def _sort_ml_rows(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.sort_values(["date", "ticker"], kind="stable").reset_index(drop=True)


def _lightgbm_version() -> str | None:
    try:
        import lightgbm
    except (ImportError, OSError):
        return None
    return str(getattr(lightgbm, "__version__", "unknown"))


def _lightgbm_deterministic_params() -> dict[str, Any]:
    return {
        "subsample": 1.0,
        "subsample_freq": 0,
        "colsample_bytree": 1.0,
        "n_jobs": 1,
        "random_state": ML_RANDOM_SEED,
        "deterministic": True,
        "force_row_wise": True,
        "data_random_seed": ML_RANDOM_SEED,
        "feature_fraction_seed": ML_RANDOM_SEED,
        "bagging_seed": ML_RANDOM_SEED,
        "extra_seed": ML_RANDOM_SEED,
        "drop_seed": ML_RANDOM_SEED,
        "objective_seed": ML_RANDOM_SEED,
    }


def run_walk_forward(
    *,
    run_id: str,
    strategy: str,
    prices: pd.DataFrame,
    start_date: str,
    end_date: str,
    benchmark_ticker: str,
    top_n: int | None = None,
    cost_bps: float | None = None,
    progress_cb: Callable[[int, int], None] | None = None,
) -> MLArtifacts:
    """Daily walk-forward ML backtest.

    Training: rolling window of train_window_days trading days (configurable via
    ML_TRAIN_WINDOW_DAYS, default 504 ≈ 2 years).

    Model refit: every ML_REFIT_FREQ_DAYS trading days (default 5 = weekly).
    Predictions and portfolio selection are still performed DAILY.

    Horizon: 1 trading day (target = next-day return).
    """
    model_impl = _model_impl_for_strategy(strategy)

    # ── Configuration ─────────────────────────────────────────────────────────
    min_train_days = int(os.getenv("ML_MIN_TRAIN_DAYS", "252"))
    train_window_days = int(os.getenv("ML_TRAIN_WINDOW_DAYS", "504"))
    model_refit_freq = int(os.getenv("ML_REFIT_FREQ_DAYS", "5"))
    top_n_cfg = int(top_n if top_n is not None else int(os.getenv("ML_TOP_N", "5")))
    cost_bps_cfg = float(
        cost_bps if cost_bps is not None else float(os.getenv("ML_COST_BPS", "10"))
    )
    cost_rate = cost_bps_cfg / 10_000.0

    # Calendar-day equivalent for the rolling training window
    # 252 trading days ≈ 365 calendar days → multiply by 365/252 ≈ 1.448
    train_window_cal_days = math.ceil(train_window_days * 365 / 252)

    print(
        f"[ML] daily pipeline active; run={run_id} strategy={strategy} "
        f"features={FEATURE_COLUMNS!r}, refit_freq={model_refit_freq}d, "
        f"train_window={train_window_days}d, min_train={min_train_days}d, horizon=1d"
    )

    # ── Build long-format feature dataset ────────────────────────────────────
    feature_frame = compute_daily_features(prices, benchmark_ticker=benchmark_ticker)
    if feature_frame.empty:
        raise RuntimeError(
            "compute_daily_features returned an empty DataFrame — check prices and benchmark_ticker"
        )

    feature_frame["date"] = pd.to_datetime(feature_frame["date"], utc=False)
    trading_dates = pd.Index(pd.to_datetime(prices.sort_index().index, utc=False))
    next_trading_dates = pd.Series(
        trading_dates[1:].to_numpy(),
        index=trading_dates[:-1],
    )
    feature_frame["target_date"] = feature_frame["date"].map(next_trading_dates)

    features_clean = feature_frame.replace([np.inf, -np.inf], np.nan)
    # Drop NaN per-row: keeps (date, symbol) pairs where ALL features are present
    model_rows = features_clean.dropna(
        subset=FEATURE_COLUMNS + ["target_return", "target_date"]
    ).copy()
    model_rows = _sort_ml_rows(model_rows)

    start_ts = pd.to_datetime(start_date)
    end_ts = pd.to_datetime(end_date)

    in_window_rows = model_rows[
        (model_rows["target_date"] >= start_ts) & (model_rows["target_date"] <= end_ts)
    ].copy()
    in_window_rows = _sort_ml_rows(in_window_rows)
    if in_window_rows.empty:
        raise RuntimeError(
            f"No ML rows in backtest window {start_date}..{end_date} after feature dropna. "
            "Check that price data covers the requested backtest window."
        )

    all_tickers = sorted(in_window_rows["ticker"].unique().tolist())
    if not all_tickers:
        raise RuntimeError("No non-benchmark tickers available for ML portfolio")

    # ── Pre-backtest validation ───────────────────────────────────────────────
    first_rebalance_date = pd.Timestamp(in_window_rows["date"].min())
    initial_window_start = first_rebalance_date - pd.Timedelta(days=train_window_cal_days)
    pre_window = model_rows[
        (model_rows["date"] >= initial_window_start)
        & (model_rows["date"] < first_rebalance_date)
        & (model_rows["ticker"].isin(all_tickers))
    ]
    n_train_rows = len(pre_window)
    n_train_days = pre_window["date"].nunique()
    avg_symbols = n_train_rows / max(n_train_days, 1)
    min_avg_syms = max(top_n_cfg, 2)
    required_rows = min_train_days * top_n_cfg

    fail_reasons: list[str] = []
    if n_train_days < min_train_days:
        fail_reasons.append(f"train_days={n_train_days} < required {min_train_days}")
    if n_train_rows < required_rows:
        fail_reasons.append(f"train_rows={n_train_rows} < required {required_rows}")
    if avg_symbols < min_avg_syms:
        fail_reasons.append(f"avg_symbols/day={avg_symbols:.1f} < required {min_avg_syms}")

    if fail_reasons:
        raise RuntimeError(
            f"Insufficient ML training data: "
            f"train_rows={n_train_rows}, train_days={n_train_days}, "
            f"avg_symbols/day={avg_symbols:.1f}, "
            f"required: train_days>={min_train_days}, "
            f"avg_symbols/day>={min_avg_syms}, "
            f"train_rows>={required_rows}. "
            f"Failures: {'; '.join(fail_reasons)}. "
            "Choose an earlier start date or ingest a broader universe."
        )

    top_n_eff = max(1, min(top_n_cfg, len(all_tickers)))
    rebalance_dates: list[pd.Timestamp] = sorted(in_window_rows["date"].unique())

    print(
        f"[engine][ml] run={run_id} strategy={strategy} stage=features done "
        f"model_rows={len(model_rows)} rebalance_dates={len(rebalance_dates)} "
        f"universe={len(all_tickers)} top_n={top_n_eff}"
    )

    # ── Walk-forward loop ─────────────────────────────────────────────────────
    all_predictions: list[dict[str, Any]] = []
    position_rows: list[dict[str, Any]] = []
    daily_portfolio: list[float] = []
    daily_benchmark: list[float] = []
    equity_dates: list[pd.Timestamp] = []
    prev_weights = pd.Series(0.0, index=all_tickers)
    model: Any = None
    last_refit_idx = -model_refit_freq  # force refit on first eligible step

    print(f"[engine][ml] run={run_id} strategy={strategy} stage=train_predict start")

    for step_idx, as_of_date in enumerate(rebalance_dates):
        # Rolling training window: [as_of_date - train_window_cal_days, as_of_date)
        window_start = as_of_date - pd.Timedelta(days=train_window_cal_days)
        train_slice = model_rows[
            (model_rows["date"] >= window_start)
            & (model_rows["date"] < as_of_date)
            & (model_rows["ticker"].isin(all_tickers))
        ]
        train_slice = _sort_ml_rows(train_slice)

        if train_slice["date"].nunique() < min_train_days:
            continue  # warmup: not enough history yet

        # Periodic refit (every model_refit_freq steps); triggers a _build_model call
        if step_idx - last_refit_idx >= model_refit_freq:
            model = _build_model(strategy)
            model.fit(_feature_matrix(train_slice), train_slice["target_return"].to_numpy())
            last_refit_idx = step_idx
            if progress_cb is not None:
                progress_cb(step_idx + 1, len(rebalance_dates))

        # Predict on current date
        test_slice = in_window_rows[
            (in_window_rows["date"] == as_of_date) & in_window_rows["ticker"].isin(all_tickers)
        ].copy()
        test_slice = _sort_ml_rows(test_slice)
        if test_slice.empty:
            continue

        preds = model.predict(_feature_matrix(test_slice))  # type: ignore[union-attr]

        if not np.isfinite(preds).all():
            raise RuntimeError(
                f"ML walk-forward produced non-finite predictions at as_of={as_of_date.strftime('%Y-%m-%d')}."
            )
        if float(np.std(preds, ddof=0)) <= 1e-12:
            raise RuntimeError(
                f"ML walk-forward produced degenerate constant predictions at as_of={as_of_date.strftime('%Y-%m-%d')}."
            )

        test_slice = test_slice.copy()
        test_slice["predicted_return"] = preds
        test_slice = test_slice.sort_values(
            ["predicted_return", "ticker"], ascending=[False, True]
        ).reset_index(drop=True)
        test_slice["rank"] = np.arange(1, len(test_slice) + 1)
        test_slice["selected"] = test_slice["rank"] <= top_n_eff
        selected_count = int(test_slice["selected"].sum())
        selected_weight = 1.0 / selected_count if selected_count > 0 else 0.0
        test_slice["weight"] = np.where(test_slice["selected"], selected_weight, 0.0)
        selected = test_slice[test_slice["selected"]]

        # Turnover
        new_weights = pd.Series(0.0, index=all_tickers)
        for _, row in selected.iterrows():
            new_weights.at[row["ticker"]] = selected_weight
        turnover = one_way_turnover(prev_weights, new_weights)
        prev_weights = new_weights

        # Returns
        gross_ret = float(selected["target_return"].mean()) if len(selected) > 0 else 0.0
        net_ret = gross_ret - cost_rate * turnover
        bench_ret_v = float(test_slice["benchmark_return"].iloc[0]) if len(test_slice) > 0 else 0.0
        target_date = pd.Timestamp(test_slice["target_date"].iloc[0])

        daily_portfolio.append(net_ret)
        daily_benchmark.append(bench_ret_v)
        equity_dates.append(target_date)

        # Accumulate predictions (trimmed to last 20 dates after loop)
        as_of_str = as_of_date.strftime("%Y-%m-%d")
        target_date_str = target_date.strftime("%Y-%m-%d")
        for _, row in test_slice.iterrows():
            all_predictions.append(
                {
                    "run_id": run_id,
                    "model_name": strategy,
                    "as_of_date": as_of_str,
                    "target_date": target_date_str,
                    "ticker": str(row["ticker"]),
                    "predicted_return": float(row["predicted_return"]),
                    "realized_return": float(row["target_return"]),
                    "rank": int(row["rank"]),
                    "selected": bool(row["selected"]),
                    "weight": float(row["weight"]),
                }
            )

        # Positions (every rebalance date)
        for _, row in selected.iterrows():
            position_rows.append(
                {
                    "run_id": run_id,
                    "date": target_date_str,
                    "symbol": str(row["ticker"]),
                    "weight": float(row["weight"]),
                }
            )

    if not daily_portfolio:
        raise RuntimeError(
            "ML walk-forward produced no rebalances — check warmup period vs backtest window"
        )

    if progress_cb is not None and rebalance_dates:
        progress_cb(len(rebalance_dates), len(rebalance_dates))

    # Trim predictions to last 20 as_of_dates
    all_as_of = sorted({r["as_of_date"] for r in all_predictions})
    last_20 = set(all_as_of[-20:])
    prediction_rows = [r for r in all_predictions if r["as_of_date"] in last_20]

    print(
        f"[engine][ml] run={run_id} strategy={strategy} stage=train_predict done "
        f"rebalances={len(equity_dates)} predictions_stored={len(prediction_rows)} "
        f"positions={len(position_rows)}"
    )

    # ── Equity curve ──────────────────────────────────────────────────────────
    portfolio_ser = pd.Series(daily_portfolio, index=equity_dates)
    benchmark_ser = pd.Series(daily_benchmark, index=equity_dates)
    portfolio_nav = 100_000.0 * (1.0 + portfolio_ser).cumprod()
    benchmark_nav = 100_000.0 * (1.0 + benchmark_ser).cumprod()

    equity_rows = [
        {
            "date": dt.strftime("%Y-%m-%d"),
            "portfolio": float(portfolio_nav.loc[dt]),
            "benchmark": float(benchmark_nav.loc[dt]),
        }
        for dt in equity_dates
    ]

    metrics = _compute_metrics(
        portfolio_ser,
        turnover=annualize_turnover_from_position_rows(position_rows, periods_per_year=252.0),
    )

    # ── Metadata ──────────────────────────────────────────────────────────────
    if model is None:
        raise RuntimeError("Model was never trained")

    rows_after_dropna = len(model_rows)
    lightgbm_version = _lightgbm_version() if model_impl == "lightgbm" else None
    deterministic_model_params = (
        _lightgbm_deterministic_params() if model_impl == "lightgbm" else None
    )
    metadata = {
        "run_id": run_id,
        "model_name": strategy,
        "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
        "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
        "train_rows": n_train_rows,
        "prediction_rows": len(prediction_rows),
        "rebalance_count": len(equity_rows),
        "top_n": top_n_eff,
        "cost_bps": cost_bps_cfg,
        "feature_columns": FEATURE_COLUMNS,
        "feature_importance": _feature_importance(model, FEATURE_COLUMNS),
        "model_params": {
            "model_impl": model_impl,
            "random_seed": ML_RANDOM_SEED,
            "horizon_days": 1,
            "train_window_days": train_window_days,
            "model_refit_frequency": model_refit_freq,
            "model_version": "factorlab_ml_daily_v1",
            "feature_set": "factorlab_daily_v1",
            "determinism_mode": (LIGHTGBM_DETERMINISM_MODE if model_impl == "lightgbm" else None),
            "lightgbm_version": lightgbm_version,
            "deterministic_model_params": deterministic_model_params,
            "rows_after_dropna": rows_after_dropna,
            "train_days": int(n_train_days),
            "avg_symbols_per_day": round(avg_symbols, 2),
            "training_window": {
                "min_train_days": min_train_days,
                "train_window_days": train_window_days,
                "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
                "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
            },
            "top_n": top_n_eff,
            "cost_bps": cost_bps_cfg,
            "warnings": [],
        },
    }

    print(f"[engine][ml] run={run_id} strategy={strategy} stage=report build")

    return MLArtifacts(
        equity_rows=equity_rows,
        metrics=metrics,
        feature_rows=[],  # daily features not stored in features_monthly (schema mismatch)
        prediction_rows=prediction_rows,
        metadata=metadata,
        position_rows=position_rows,
    )
