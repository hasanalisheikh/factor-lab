from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLUMNS = [
  "momentum_12_1",
  "momentum_6_1",
  "reversal_1m",
  "vol_20d",
  "vol_60d",
  "beta_60d",
  "drawdown_6m",
]


@dataclass(frozen=True)
class MLArtifacts:
  equity_rows: list[dict[str, Any]]
  metrics: dict[str, float]
  feature_rows: list[dict[str, Any]]
  prediction_rows: list[dict[str, Any]]
  metadata: dict[str, Any]
  position_rows: list[dict[str, Any]]


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


def _rolling_beta(asset_ret: pd.Series, benchmark_ret: pd.Series, window: int = 60) -> pd.Series:
  cov = asset_ret.rolling(window=window).cov(benchmark_ret)
  var = benchmark_ret.rolling(window=window).var()
  beta = cov / var.replace(0, np.nan)
  return beta.replace([np.inf, -np.inf], np.nan)


def compute_monthly_features(prices: pd.DataFrame, benchmark_ticker: str) -> pd.DataFrame:
  prices = prices.sort_index().ffill().dropna(how="all")
  daily_ret = prices.pct_change()
  monthly_px = prices.resample("ME").last().ffill().dropna(how="all")
  monthly_ret = monthly_px.pct_change()

  momentum_12_1 = monthly_px.shift(1) / monthly_px.shift(12) - 1.0
  momentum_6_1 = monthly_px.shift(1) / monthly_px.shift(6) - 1.0
  reversal_1m = -monthly_ret.shift(1)

  vol_20d_daily = daily_ret.rolling(20).std(ddof=0)
  vol_60d_daily = daily_ret.rolling(60).std(ddof=0)

  benchmark_daily_ret = daily_ret[benchmark_ticker]
  beta_60d_daily = pd.DataFrame(index=daily_ret.index, columns=daily_ret.columns, dtype=float)
  for ticker in daily_ret.columns:
    beta_60d_daily[ticker] = _rolling_beta(daily_ret[ticker], benchmark_daily_ret, window=60)

  drawdown_6m_daily = prices / prices.rolling(126).max() - 1.0

  vol_20d = vol_20d_daily.resample("ME").last()
  vol_60d = vol_60d_daily.resample("ME").last()
  beta_60d = beta_60d_daily.resample("ME").last()
  drawdown_6m = drawdown_6m_daily.resample("ME").last()

  next_ret = monthly_ret.shift(-1)
  rows: list[dict[str, Any]] = []
  for dt in monthly_px.index:
    for ticker in monthly_px.columns:
      rows.append(
        {
          "date": dt.strftime("%Y-%m-%d"),
          "ticker": ticker,
          "momentum_12_1": float(momentum_12_1.at[dt, ticker]) if pd.notna(momentum_12_1.at[dt, ticker]) else np.nan,
          "momentum_6_1": float(momentum_6_1.at[dt, ticker]) if pd.notna(momentum_6_1.at[dt, ticker]) else np.nan,
          "reversal_1m": float(reversal_1m.at[dt, ticker]) if pd.notna(reversal_1m.at[dt, ticker]) else np.nan,
          "vol_20d": float(vol_20d.at[dt, ticker]) if pd.notna(vol_20d.at[dt, ticker]) else np.nan,
          "vol_60d": float(vol_60d.at[dt, ticker]) if pd.notna(vol_60d.at[dt, ticker]) else np.nan,
          "beta_60d": float(beta_60d.at[dt, ticker]) if pd.notna(beta_60d.at[dt, ticker]) else np.nan,
          "drawdown_6m": float(drawdown_6m.at[dt, ticker]) if pd.notna(drawdown_6m.at[dt, ticker]) else np.nan,
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
    except Exception as exc:
      print(f"[engine][ml] lightgbm unavailable; using ridge fallback: {exc}")
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
  top_n: int | None = None,
  cost_bps: float | None = None,
) -> MLArtifacts:
  min_train_months = int(os.getenv("ML_MIN_TRAIN_MONTHS", "24"))
  top_n_cfg = int(top_n if top_n is not None else int(os.getenv("ML_TOP_N", "10")))
  cost_bps_cfg = float(cost_bps if cost_bps is not None else float(os.getenv("ML_COST_BPS", "10")))
  cost_rate = cost_bps_cfg / 10_000.0

  print(f"[engine][ml] run={run_id} strategy={strategy} stage=features start")
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

  warnings: list[str] = []
  if len(all_tickers) < 12:
    warnings.append(
      f"Small universe: {len(all_tickers)} symbols. ML signal quality may be limited."
    )

  top_n = max(1, min(top_n_cfg, len(all_tickers)))
  rebalance_dates = sorted(in_window_rows["date"].unique())

  print(
    f"[engine][ml] run={run_id} strategy={strategy} stage=features done "
    f"rows={len(model_rows)} rebalances={len(rebalance_dates)} universe={len(all_tickers)}"
  )

  prediction_rows: list[dict[str, Any]] = []
  position_rows: list[dict[str, Any]] = []
  monthly_portfolio: list[float] = []
  monthly_benchmark: list[float] = []
  equity_dates: list[pd.Timestamp] = []
  turnovers: list[float] = []
  prev_weights = pd.Series(0.0, index=all_tickers)
  train_rows_count = 0
  trained_month_count = 0
  model = None

  print(f"[engine][ml] run={run_id} strategy={strategy} stage=train_backtest start")
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
    trained_month_count += 1

    test_slice["predicted_return"] = model.predict(test_slice[FEATURE_COLUMNS])
    test_slice = test_slice.sort_values("predicted_return", ascending=False).reset_index(drop=True)
    test_slice["rank"] = np.arange(1, len(test_slice) + 1)
    test_slice["selected"] = test_slice["rank"] <= top_n
    selected_count = int(test_slice["selected"].sum())
    selected_weight = 1.0 / selected_count if selected_count > 0 else 0.0
    test_slice["weight"] = np.where(test_slice["selected"], selected_weight, 0.0)
    selected = test_slice[test_slice["selected"]].copy()

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

    if len(selected) > 0:
      for _, row in selected.iterrows():
        position_rows.append(
          {
            "run_id": run_id,
            "date": pd.Timestamp(as_of_date).strftime("%Y-%m-%d"),
            "symbol": str(row["ticker"]),
            "weight": float(row["weight"]),
          }
        )

  if not monthly_portfolio:
    raise RuntimeError("ML walk-forward produced no rebalances")

  print(
    f"[engine][ml] run={run_id} strategy={strategy} stage=train_backtest done "
    f"trained_months={trained_month_count} predictions={len(prediction_rows)}"
  )

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
      "momentum": float(row["momentum_12_1"]),
      "reversal": float(row["reversal_1m"]),
      "volatility": float(row["vol_60d"]),
      "beta": float(row["beta_60d"]),
      "drawdown": float(row["drawdown_6m"]),
      "momentum_12_1": float(row["momentum_12_1"]),
      "momentum_6_1": float(row["momentum_6_1"]),
      "reversal_1m": float(row["reversal_1m"]),
      "vol_20d": float(row["vol_20d"]),
      "vol_60d": float(row["vol_60d"]),
      "beta_60d": float(row["beta_60d"]),
      "drawdown_6m": float(row["drawdown_6m"]),
    }
    for _, row in features_clean.dropna(subset=FEATURE_COLUMNS).iterrows()
  ]

  if model is None:
    raise RuntimeError("Model was not trained")

  print(f"[engine][ml] run={run_id} strategy={strategy} stage=report build")
  metadata = {
    "run_id": run_id,
    "model_name": strategy,
    "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
    "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
    "train_rows": int(train_rows_count),
    "prediction_rows": int(len(prediction_rows)),
    "rebalance_count": int(len(equity_rows)),
    "top_n": int(top_n),
    "cost_bps": float(cost_bps_cfg),
    "feature_columns": FEATURE_COLUMNS,
    "feature_importance": _feature_importance(model, FEATURE_COLUMNS),
    "model_params": {
      "min_train_months": min_train_months,
      "top_n": top_n,
      "cost_bps": cost_bps_cfg,
      "warnings": warnings,
    },
  }

  return MLArtifacts(
    equity_rows=equity_rows,
    metrics=metrics,
    feature_rows=feature_rows,
    prediction_rows=prediction_rows,
    metadata=metadata,
    position_rows=position_rows,
  )
