from __future__ import annotations

from typing import Any

import pandas as pd

from factorlab_engine.turnover import annualize_turnover, one_way_turnover

from .settings import (
    _ALL_CASH_SENTINEL,
    _LOW_VOL_WINDOW,
    _TREND_SMA_WINDOW,
)


def _slice_frame_to_run_window(frame: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    mask = (frame.index >= pd.Timestamp(start)) & (frame.index <= pd.Timestamp(end))
    return frame.loc[mask].copy()


def _slice_series_to_run_window(series: pd.Series, start: str, end: str) -> pd.Series:
    mask = (series.index >= pd.Timestamp(start)) & (series.index <= pd.Timestamp(end))
    window = series.loc[mask].copy()
    if not window.empty:
        window.iloc[0] = 0.0
    return window


def _slice_positions_to_run_window(
    rows: list[dict[str, Any]],
    start: str,
    end: str,
) -> list[dict[str, Any]]:
    return [row for row in rows if start <= str(row.get("date", "")) <= end]


def _rebalance_turnover_points(
    rebalance_turnover: pd.Series, *, periods_per_year: float
) -> pd.Series:
    clean = rebalance_turnover.astype(float).fillna(0.0)
    if clean.empty:
        return clean

    if not isinstance(clean.index, pd.DatetimeIndex):
        return clean

    if periods_per_year >= 252.0:
        return clean

    month_periods = clean.index.to_series().dt.to_period("M")
    rebalance_mask = month_periods.ne(month_periods.shift(1))
    return clean.loc[rebalance_mask.values]


def _annualize_turnover_from_rebalances(
    rebalance_turnover: pd.Series,
    *,
    periods_per_year: float = 12.0,
    exclude_initial: bool = True,
) -> float:
    rebalance_points = _rebalance_turnover_points(
        rebalance_turnover, periods_per_year=periods_per_year
    )
    return annualize_turnover(
        rebalance_points,
        periods_per_year=periods_per_year,
        exclude_initial=exclude_initial,
    )


def _get_ticker_inception_dates(prices: pd.DataFrame) -> dict[str, pd.Timestamp]:
    """Return the first date with a non-NaN price for each column in the prices frame."""
    inception: dict[str, pd.Timestamp] = {}
    for col in prices.columns:
        valid = prices[col].dropna()
        if not valid.empty:
            inception[col] = valid.index[0]
    return inception


def _drift_weights(
    prev_date: pd.Timestamp,
    prev_weights: pd.Series,
    prices: pd.DataFrame,
    curr_date: pd.Timestamp,
) -> pd.Series:
    """Compute actual pre-rebalance weights by applying price growth since the last rebalance.

    This gives the drifted portfolio weights that a buy-and-hold investor would have at curr_date
    if they last rebalanced at prev_date to prev_weights.  Used to capture drift-reset turnover.
    Falls back to prev_weights if any price data is missing or degenerate.
    """
    if prev_weights.sum() <= 0:
        return prev_weights
    held = prev_weights[prev_weights > 0]
    prev_p = prices.loc[prev_date, held.index]
    curr_p = prices.loc[curr_date, held.index]
    safe_prev = prev_p.where(prev_p > 0, other=float("nan"))
    growth = curr_p / safe_prev
    drifted_vals = (held * growth).dropna()
    total = float(drifted_vals.sum())
    if total <= 0:
        return prev_weights
    actual = pd.Series(0.0, index=prev_weights.index)
    actual[drifted_vals.index] = drifted_vals / total
    return actual


def _equal_weight(prices: pd.DataFrame) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    # Compute per-ticker inception dates so pre-launch tickers are excluded at each rebalance.
    inception_dates = _get_ticker_inception_dates(prices)

    rets = prices.pct_change().fillna(0.0)
    portfolio_rets = pd.Series(0.0, index=prices.index)
    monthly_turnover = pd.Series(0.0, index=prices.index)

    # Collect rebalance-date positions (first day of each month), excluding pre-inception tickers.
    rebalance_positions: list[dict[str, Any]] = []
    prev_month = None
    active_weights = pd.Series(0.0, index=prices.columns)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    prev_rebalance_date: pd.Timestamp | None = None

    for dt in prices.index:
        current_month = dt.to_period("M")
        if current_month != prev_month:
            prev_month = current_month
            # Available = tickers that have launched by this rebalance date
            available_cols = [col for col in prices.columns if inception_dates.get(col, dt) <= dt]
            n = len(available_cols)
            weight_per_asset = 1.0 / n if n > 0 else 0.0
            current_w = pd.Series(0.0, index=prices.columns)
            if n > 0:
                current_w.loc[available_cols] = weight_per_asset
            actual_prev = (
                _drift_weights(prev_rebalance_date, prev_rebalance_weights, prices, dt)
                if prev_rebalance_date is not None
                else prev_rebalance_weights
            )
            monthly_turnover.loc[dt] = one_way_turnover(actual_prev, current_w)
            prev_rebalance_weights = current_w.copy()
            prev_rebalance_date = dt
            active_weights = current_w.copy()

            if n == 0:
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": _ALL_CASH_SENTINEL,
                        "weight": 0.0,
                    }
                )
            else:
                for col in available_cols:
                    rebalance_positions.append(
                        {
                            "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                            "symbol": str(col),
                            "weight": weight_per_asset,
                        }
                    )

        # Daily portfolio return using weights set at last rebalance
        portfolio_rets.loc[dt] = float((rets.loc[dt] * active_weights).sum())

    annualized_turnover = _annualize_turnover_from_rebalances(
        monthly_turnover, periods_per_year=12.0
    )
    return portfolio_rets, annualized_turnover, monthly_turnover, rebalance_positions


def _momentum_12_1(
    prices: pd.DataFrame,
    top_n: int | None = None,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    asset_rets = prices.pct_change().fillna(0.0)
    scores = prices.shift(21) / prices.shift(252) - 1.0

    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    n_assets = prices.shape[1]
    # Use provided top_n if given; default to top-half of universe (legacy behaviour).
    effective_top_n = max(1, min(int(top_n), n_assets) if top_n is not None else n_assets // 2)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    prev_rebalance_date: pd.Timestamp | None = None
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            # dropna() is inception-aware: tickers with insufficient lookback history
            # (including pre-launch tickers) return NaN scores and are excluded naturally.
            s = scores.loc[dt].dropna()
            s = s[s > 0].sort_values(ascending=False).head(effective_top_n)
            current_w = pd.Series(0.0, index=prices.columns)
            if not s.empty:
                current_w.loc[s.index] = 1.0 / len(s)
            actual_prev = (
                _drift_weights(prev_rebalance_date, prev_rebalance_weights, prices, dt)
                if prev_rebalance_date is not None
                else prev_rebalance_weights
            )
            rebalance_turnover.loc[dt] = one_way_turnover(actual_prev, current_w)
            prev_rebalance_weights = current_w.copy()
            prev_rebalance_date = dt

            # Snapshot positions at this rebalance date.  When no asset qualifies
            # (all scores <= 0), write a sentinel row so the date is auditable in the DB.
            positive_w = current_w[current_w > 0]
            if positive_w.empty:
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": _ALL_CASH_SENTINEL,
                        "weight": 0.0,
                    }
                )
            else:
                for sym, wt in positive_w.items():
                    rebalance_positions.append(
                        {
                            "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                            "symbol": str(sym),
                            "weight": float(wt),
                        }
                    )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    annualized_turnover = _annualize_turnover_from_rebalances(
        rebalance_turnover, periods_per_year=12.0
    )
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions


def _low_vol(
    prices: pd.DataFrame,
    top_n: int,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    """Low Volatility: select the top_n assets with the lowest 60-day realized vol each month."""
    if prices.shape[0] < _LOW_VOL_WINDOW:
        raise ValueError(
            f"Low Volatility strategy requires at least {_LOW_VOL_WINDOW} daily data points "
            "to compute 60-day realized volatility. Choose a longer date range."
        )

    asset_rets = prices.pct_change().fillna(0.0)
    vol_60 = asset_rets.rolling(_LOW_VOL_WINDOW).std(ddof=0)

    n_assets = prices.shape[1]
    top_n_clamped = min(max(1, top_n), n_assets)

    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    prev_rebalance_date: pd.Timestamp | None = None
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            vols = vol_60.loc[dt].dropna().sort_values(ascending=True)
            selected = vols.head(top_n_clamped)
            current_w = pd.Series(0.0, index=prices.columns)
            if not selected.empty:
                current_w.loc[selected.index] = 1.0 / len(selected)
            actual_prev = (
                _drift_weights(prev_rebalance_date, prev_rebalance_weights, prices, dt)
                if prev_rebalance_date is not None
                else prev_rebalance_weights
            )
            rebalance_turnover.loc[dt] = one_way_turnover(actual_prev, current_w)
            prev_rebalance_weights = current_w.copy()
            prev_rebalance_date = dt
            positive_w_lv = current_w[current_w > 0]
            if positive_w_lv.empty:
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": _ALL_CASH_SENTINEL,
                        "weight": 0.0,
                    }
                )
            else:
                for sym, wt in positive_w_lv.items():
                    rebalance_positions.append(
                        {
                            "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                            "symbol": str(sym),
                            "weight": float(wt),
                        }
                    )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    annualized_turnover = _annualize_turnover_from_rebalances(
        rebalance_turnover, periods_per_year=12.0
    )
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions


def _trend_filter(
    prices: pd.DataFrame,
    universe_tickers: list[str],
    benchmark_ticker: str,
    defensive_ticker: str,
    top_n: int | None = None,
) -> tuple[pd.Series, float, pd.Series, list[dict[str, Any]]]:
    """Trend Filter: risk-on (Momentum 12-1) when benchmark > SMA-200; risk-off (TLT) otherwise."""
    if benchmark_ticker not in prices.columns:
        raise ValueError(f"Benchmark ticker {benchmark_ticker!r} not found in price data.")
    if defensive_ticker not in prices.columns:
        raise ValueError(
            f"Defensive ticker {defensive_ticker!r} not available for risk-off allocation. "
            "Ensure TLT or BIL data is ingested for the requested date range."
        )

    bench = prices[benchmark_ticker]
    n_bench_valid = int(bench.dropna().shape[0])
    if n_bench_valid < _TREND_SMA_WINDOW:
        raise ValueError(
            f"Trend Filter strategy requires at least {_TREND_SMA_WINDOW} daily benchmark data points "
            f"to compute the 200-day SMA. Got {n_bench_valid} points. "
            "Choose a longer date range or earlier start date."
        )

    bench_sma200 = bench.rolling(_TREND_SMA_WINDOW).mean()

    universe_cols = [c for c in universe_tickers if c in prices.columns]
    if not universe_cols:
        raise ValueError("No universe tickers found in price data.")

    universe_prices = prices[universe_cols]
    # Momentum 12-1 scores for risk-on selection (replicates _momentum_12_1 logic)
    scores = universe_prices.shift(21) / universe_prices.shift(252) - 1.0
    # Use provided top_n if given; default to top-half of universe (legacy behaviour).
    n_universe = len(universe_cols)
    top_n_risk_on = max(1, min(int(top_n), n_universe) if top_n is not None else n_universe // 2)

    asset_rets = prices.pct_change().fillna(0.0)
    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    current_w = pd.Series(0.0, index=prices.columns)
    rebalance_turnover = pd.Series(0.0, index=prices.index)
    prev_rebalance_weights = pd.Series(0.0, index=prices.columns)
    prev_rebalance_date: pd.Timestamp | None = None
    rebalance_positions: list[dict[str, Any]] = []

    for i, dt in enumerate(prices.index):
        if i == 0 or dt.month != prices.index[i - 1].month:
            bench_val = bench.loc[dt]
            sma_val = bench_sma200.loc[dt]
            risk_on = bool(
                pd.notna(bench_val) and pd.notna(sma_val) and float(bench_val) > float(sma_val)
            )
            current_w = pd.Series(0.0, index=prices.columns)
            if risk_on:
                s = scores.loc[dt].dropna()
                s = s[s > 0].sort_values(ascending=False).head(top_n_risk_on)
                if not s.empty:
                    current_w.loc[s.index] = 1.0 / len(s)
                else:
                    # No positive momentum signal: fall back to equal-weight universe
                    current_w.loc[universe_cols] = 1.0 / len(universe_cols)
            else:
                # Risk-off: 100% defensive asset
                current_w.loc[defensive_ticker] = 1.0
            actual_prev = (
                _drift_weights(prev_rebalance_date, prev_rebalance_weights, prices, dt)
                if prev_rebalance_date is not None
                else prev_rebalance_weights
            )
            rebalance_turnover.loc[dt] = one_way_turnover(actual_prev, current_w)
            prev_rebalance_weights = current_w.copy()
            prev_rebalance_date = dt
            for sym, wt in current_w[current_w > 0].items():
                rebalance_positions.append(
                    {
                        "date": pd.Timestamp(dt).strftime("%Y-%m-%d"),
                        "symbol": str(sym),
                        "weight": float(wt),
                    }
                )
        weights.loc[dt] = current_w

    shifted = weights.shift(1).fillna(0.0)
    portfolio_rets = (asset_rets * shifted).sum(axis=1)
    annualized_turnover = _annualize_turnover_from_rebalances(
        rebalance_turnover, periods_per_year=12.0
    )
    return portfolio_rets, annualized_turnover, rebalance_turnover, rebalance_positions
