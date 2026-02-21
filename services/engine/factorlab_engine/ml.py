from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLUMNS = ["momentum", "reversal", "volatility", "beta", "drawdown"]


@dataclass(frozen=True)
class MLArtifacts:
  equity_rows: list[dict[str, Any]]
  metrics: dict[str, float]
  feature_rows: list[dict[str, Any]]
  prediction_rows: list[dict[str, Any]]
  metadata: dict[str, Any]


def _compute_metrics(returns: pd.Series, turnover: float) -> dict[str, float]:
  clean = returns.replace([np.inf, -np.inf], np.nan).dropna()
  if clean.empty:
    raise ValueError("No returns available for ML metrics")

  mean_period = float(clean.mean())
  vol_period = float(clean.std(ddof=0))
  ann_factor = np.sqrt(12.0)
  volatility = vol_period * ann_factor
  sharpe = (mean_period / vol_period) * ann_factor if vol_period > 0 else 0.0

  equity = (1.0 + clean).cumprod()
  peak = equity.cummax()
  drawdown = equity / peak - 1.0
  max_drawdown = float(drawdown.min())

  n = len(clean)
  cagr = float(equity.iloc[-1] ** (12.0 / n) - 1.0) if n > 0 else 0.0
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


def _rolling_beta(asset_ret: pd.Series, benchmark_ret: pd.Series, window: int = 12) -> pd.Series:
  cov = asset_ret.rolling(window=window).cov(benchmark_ret)
  var = benchmark_ret.rolling(window=window).var()
  beta = cov / var.replace(0, np.nan)
  return beta.replace([np.inf, -np.inf], np.nan)


def compute_monthly_features(prices: pd.DataFrame, benchmark_ticker: str) -> pd.DataFrame:
  monthly_px = prices.resample("ME").last().ffill().dropna(how="all")
  monthly_ret = monthly_px.pct_change()

  momentum = monthly_px.shift(1) / monthly_px.shift(12) - 1.0
  reversal = -monthly_ret.shift(1)
  volatility = monthly_ret.rolling(6).std(ddof=0) * np.sqrt(12.0)
  drawdown = monthly_px / monthly_px.rolling(12).max() - 1.0

  benchmark_ret = monthly_ret[benchmark_ticker]
  beta = pd.DataFrame(index=monthly_px.index, columns=monthly_px.columns, dtype=float)
  for ticker in monthly_px.columns:
    beta[ticker] = _rolling_beta(monthly_ret[ticker], benchmark_ret)

  next_ret = monthly_ret.shift(-1)
  rows: list[dict[str, Any]] = []
  for dt in monthly_px.index:
    for ticker in monthly_px.columns:
      rows.append(
        {
          "date": dt.strftime("%Y-%m-%d"),
          "ticker": ticker,
          "momentum": float(momentum.at[dt, ticker]) if pd.notna(momentum.at[dt, ticker]) else np.nan,
          "reversal": float(reversal.at[dt, ticker]) if pd.notna(reversal.at[dt, ticker]) else np.nan,
          "volatility": float(volatility.at[dt, ticker]) if pd.notna(volatility.at[dt, ticker]) else np.nan,
          "beta": float(beta.at[dt, ticker]) if pd.notna(beta.at[dt, ticker]) else np.nan,
          "drawdown": float(drawdown.at[dt, ticker]) if pd.notna(drawdown.at[dt, ticker]) else np.nan,
          "target_return": float(next_ret.at[dt, ticker]) if pd.notna(next_ret.at[dt, ticker]) else np.nan,
          "benchmark_return": float(next_ret.at[dt, benchmark_ticker]) if pd.notna(next_ret.at[dt, benchmark_ticker]) else np.nan,
        }
      )

  frame = pd.DataFrame(rows)
  return frame


def _build_model(strategy: str):
  if strategy == "ml_ridge":
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0, random_state=0))

  if strategy == "ml_lightgbm":
    try:
      from lightgbm import LGBMRegressor

      return LGBMRegressor(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        min_child_samples=20,
        random_state=0,
      )
    except Exception:
      return make_pipeline(StandardScaler(), Ridge(alpha=0.7, random_state=0))

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


def run_walk_forward(
  *,
  run_id: str,
  strategy: str,
  prices: pd.DataFrame,
  start_date: str,
  end_date: str,
  benchmark_ticker: str,
) -> MLArtifacts:
  min_train_months = int(os.getenv("ML_MIN_TRAIN_MONTHS", "24"))
  top_n_cfg = int(os.getenv("ML_TOP_N", "10"))
  cost_bps = float(os.getenv("ML_COST_BPS", "10"))
  cost_rate = cost_bps / 10_000.0

  feature_frame = compute_monthly_features(prices, benchmark_ticker=benchmark_ticker)
  feature_frame["date"] = pd.to_datetime(feature_frame["date"], utc=False)
  feature_frame["target_date"] = feature_frame["date"] + pd.offsets.MonthEnd(1)

  features_clean = feature_frame.replace([np.inf, -np.inf], np.nan)
  model_rows = features_clean.dropna(subset=FEATURE_COLUMNS + ["target_return"]).copy()
  in_window_rows = model_rows[
    (model_rows["target_date"] >= pd.to_datetime(start_date))
    & (model_rows["target_date"] <= pd.to_datetime(end_date))
  ].copy()
  if in_window_rows.empty:
    raise RuntimeError("Insufficient rows for ML walk-forward")

  all_tickers = sorted(in_window_rows["ticker"].unique().tolist())
  if benchmark_ticker in all_tickers:
    all_tickers.remove(benchmark_ticker)
  if not all_tickers:
    raise RuntimeError("No non-benchmark tickers available for ML portfolio")

  top_n = max(1, min(top_n_cfg, len(all_tickers)))
  rebalance_dates = sorted(in_window_rows["date"].unique())

  prediction_rows: list[dict[str, Any]] = []
  monthly_portfolio: list[float] = []
  monthly_benchmark: list[float] = []
  equity_dates: list[pd.Timestamp] = []
  turnovers: list[float] = []
  prev_weights = pd.Series(0.0, index=all_tickers)
  train_rows_count = 0
  model = None

  for as_of_date in rebalance_dates:
    train_slice = model_rows[(model_rows["date"] < as_of_date) & (model_rows["ticker"].isin(all_tickers))]
    if train_slice["date"].nunique() < min_train_months:
      continue

    test_slice = in_window_rows[in_window_rows["date"] == as_of_date].copy()
    test_slice = test_slice[test_slice["ticker"].isin(all_tickers)]
    if test_slice.empty:
      continue

    model = _build_model(strategy)
    model.fit(train_slice[FEATURE_COLUMNS], train_slice["target_return"])
    train_rows_count = len(train_slice)

    test_slice["predicted_return"] = model.predict(test_slice[FEATURE_COLUMNS])
    test_slice = test_slice.sort_values("predicted_return", ascending=False).reset_index(drop=True)
    test_slice["rank"] = np.arange(1, len(test_slice) + 1)
    test_slice["selected"] = test_slice["rank"] <= top_n
    selected = test_slice[test_slice["selected"]].copy()
    selected_weight = 1.0 / len(selected) if len(selected) > 0 else 0.0
    test_slice["weight"] = np.where(test_slice["selected"], selected_weight, 0.0)

    new_weights = pd.Series(0.0, index=all_tickers)
    if len(selected) > 0:
      for _, row in selected.iterrows():
        new_weights.at[row["ticker"]] = selected_weight

    turnover = float((new_weights - prev_weights).abs().sum() / 2.0)
    prev_weights = new_weights
    turnovers.append(turnover)

    gross_ret = float(selected["target_return"].mean()) if len(selected) > 0 else 0.0
    net_ret = gross_ret - cost_rate * turnover
    benchmark_ret = float(test_slice["benchmark_return"].iloc[0]) if len(test_slice) > 0 else 0.0

    monthly_portfolio.append(net_ret)
    monthly_benchmark.append(benchmark_ret)
    target_date = pd.Timestamp(test_slice["target_date"].iloc[0])
    equity_dates.append(target_date)

    for _, row in test_slice.iterrows():
      prediction_rows.append(
        {
          "run_id": run_id,
          "model_name": strategy,
          "as_of_date": pd.Timestamp(as_of_date).strftime("%Y-%m-%d"),
          "target_date": target_date.strftime("%Y-%m-%d"),
          "ticker": str(row["ticker"]),
          "predicted_return": float(row["predicted_return"]),
          "realized_return": float(row["target_return"]),
          "rank": int(row["rank"]),
          "selected": bool(row["selected"]),
          "weight": float(row["weight"]),
        }
      )

  if not monthly_portfolio:
    raise RuntimeError("ML walk-forward produced no rebalances")

  portfolio_ser = pd.Series(monthly_portfolio, index=equity_dates)
  benchmark_ser = pd.Series(monthly_benchmark, index=equity_dates)
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

  metrics = _compute_metrics(portfolio_ser, turnover=float(np.mean(turnovers) if turnovers else 0.0))
  feature_rows = [
    {
      "ticker": row["ticker"],
      "date": pd.Timestamp(row["date"]).strftime("%Y-%m-%d"),
      "momentum": float(row["momentum"]),
      "reversal": float(row["reversal"]),
      "volatility": float(row["volatility"]),
      "beta": float(row["beta"]),
      "drawdown": float(row["drawdown"]),
    }
    for _, row in features_clean.dropna(subset=FEATURE_COLUMNS).iterrows()
  ]

  if model is None:
    raise RuntimeError("Model was not trained")

  metadata = {
    "run_id": run_id,
    "model_name": strategy,
    "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
    "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
    "train_rows": int(train_rows_count),
    "prediction_rows": int(len(prediction_rows)),
    "rebalance_count": int(len(equity_rows)),
    "top_n": int(top_n),
    "cost_bps": float(cost_bps),
    "feature_columns": FEATURE_COLUMNS,
    "feature_importance": _feature_importance(model, FEATURE_COLUMNS),
    "model_params": {
      "min_train_months": min_train_months,
      "top_n": top_n,
      "cost_bps": cost_bps,
    },
  }

  return MLArtifacts(
    equity_rows=equity_rows,
    metrics=metrics,
    feature_rows=feature_rows,
    prediction_rows=prediction_rows,
    metadata=metadata,
  )
