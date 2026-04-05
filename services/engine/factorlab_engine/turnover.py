from __future__ import annotations

from typing import Any

import pandas as pd


def _coerce_weights(weights: pd.Series | dict[str, Any]) -> pd.Series:
    if isinstance(weights, pd.Series):
        return weights.astype(float).fillna(0.0)
    return pd.Series({str(k): float(v) for k, v in weights.items()}, dtype=float).fillna(0.0)


def one_way_turnover(
    prev_weights: pd.Series | dict[str, Any], curr_weights: pd.Series | dict[str, Any]
) -> float:
    prev = _coerce_weights(prev_weights)
    curr = _coerce_weights(curr_weights)
    aligned_index = prev.index.union(curr.index)
    delta = curr.reindex(aligned_index, fill_value=0.0) - prev.reindex(
        aligned_index, fill_value=0.0
    )
    return float(delta.abs().sum() / 2.0)


def annualize_turnover(
    rebalance_turnover: pd.Series,
    *,
    periods_per_year: float,
    exclude_initial: bool = True,
) -> float:
    clean = rebalance_turnover.astype(float).fillna(0.0)
    if clean.empty:
        return 0.0

    if exclude_initial:
        clean = clean.iloc[1:]

    return float(clean.mean() * periods_per_year) if len(clean) > 0 else 0.0


def turnover_series_from_position_rows(position_rows: list[dict[str, Any]]) -> pd.Series:
    if not position_rows:
        return pd.Series(dtype=float)

    grouped: dict[str, dict[str, float]] = {}
    for row in position_rows:
        date = str(row.get("date", ""))
        symbol = str(row.get("symbol", ""))
        if not date or not symbol:
            continue
        grouped.setdefault(date, {})[symbol] = float(row.get("weight") or 0.0)

    dates = sorted(grouped)
    prev_weights = pd.Series(dtype=float)
    turnovers: list[float] = []

    for date in dates:
        curr_weights = pd.Series(grouped[date], dtype=float)
        turnovers.append(one_way_turnover(prev_weights, curr_weights))
        prev_weights = curr_weights

    return pd.Series(turnovers, index=pd.to_datetime(dates))


def annualize_turnover_from_position_rows(
    position_rows: list[dict[str, Any]], *, periods_per_year: float
) -> float:
    return annualize_turnover(
        turnover_series_from_position_rows(position_rows),
        periods_per_year=periods_per_year,
    )
