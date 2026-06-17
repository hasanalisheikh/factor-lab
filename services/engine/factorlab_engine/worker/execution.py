from __future__ import annotations

import os
from typing import Any

import pandas as pd

from factorlab_engine.ml import run_walk_forward
from factorlab_engine.supabase_io import SupabaseIO

from .pricing import (
    _download_prices,
    _ensure_min_history,
    _persist_prices_to_db,
    _resolve_run_benchmark_ticker,
    _select_available_benchmark_ticker,
)
from .progress import (
    _apply_rebalance_costs,
    _build_price_snapshot_metadata,
    _compute_metrics,
    _equity_rows,
    _ml_required_snapshot_cutoff,
    _read_initial_capital,
    _validate_ml_snapshot_prices,
)
from .settings import (
    _TREND_DEFENSIVE,
    _TREND_DEFENSIVE_FALLBACK,
    BacktestResult,
    ProgressCallback,
    _baseline_warmup_calendar_days,
    _subtract_calendar_days,
    resolve_universe_symbols,
)
from .strategies import (
    _annualize_turnover_from_rebalances,
    _equal_weight,
    _low_vol,
    _momentum_12_1,
    _slice_frame_to_run_window,
    _slice_positions_to_run_window,
    _slice_series_to_run_window,
    _trend_filter,
)


def _build_baseline_result(
    io: SupabaseIO,
    run: dict[str, Any],
    *,
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    universe_tickers = resolve_universe_symbols(run)
    tickers = list(universe_tickers)
    benchmark_ticker_raw = _resolve_run_benchmark_ticker(run)
    if benchmark_ticker_raw not in tickers:
        tickers = [*tickers, benchmark_ticker_raw]

    strat = run["strategy_id"]
    costs_bps = float(run.get("costs_bps") or 0.0)
    top_n = int(run.get("top_n") or 5)
    run_start = str(run["start_date"])
    run_end = str(run["end_date"])
    warmup_start = _subtract_calendar_days(run_start, _baseline_warmup_calendar_days(strat))

    # trend_filter needs the defensive ticker in the price data
    defensive_ticker: str | None = None
    if strat == "trend_filter":
        defensive_ticker = _TREND_DEFENSIVE
        if defensive_ticker not in tickers:
            tickers = [*tickers, defensive_ticker]

    if on_progress:
        on_progress("load_data", 20)
    prices = io.fetch_prices_frame(tickers, warmup_start, run_end)
    _prices_stale = (
        prices.empty
        or prices.shape[0] < 40
        or prices.index.max() < pd.Timestamp(run_end) - pd.Timedelta(days=5)
    )
    if _prices_stale:
        prices = _download_prices(warmup_start, run_end, tickers)
        _persist_prices_to_db(io, prices)

    # For trend_filter: if defensive ticker still missing, try BIL fallback
    if (
        strat == "trend_filter"
        and defensive_ticker is not None
        and defensive_ticker not in prices.columns
    ):
        fallback = _TREND_DEFENSIVE_FALLBACK
        tickers_fb = [t for t in tickers if t != defensive_ticker] + [fallback]
        try:
            prices_fb = _download_prices(warmup_start, run_end, tickers_fb)
            if fallback in prices_fb.columns:
                defensive_ticker = fallback
                prices = prices_fb
                _persist_prices_to_db(io, prices)
            else:
                raise ValueError(
                    f"Trend Filter requires a defensive asset for risk-off allocation. "
                    f"Tried {_TREND_DEFENSIVE!r} and {_TREND_DEFENSIVE_FALLBACK!r} but neither "
                    "was available. Check data coverage for the requested date range."
                )
        except RuntimeError as exc:
            raise ValueError(
                f"Trend Filter requires {_TREND_DEFENSIVE!r} or {_TREND_DEFENSIVE_FALLBACK!r} "
                f"for risk-off allocation, but download failed: {exc}"
            ) from exc

    run_window_prices = _slice_frame_to_run_window(prices, run_start, run_end)
    _ensure_min_history(run_window_prices, context=f"run {run['id']} strategy {strat}")
    bench_col = _select_available_benchmark_ticker(benchmark_ticker_raw, prices.columns)

    if on_progress:
        on_progress("compute_signals", 40)
    # Slice prices to investable universe only. The full `prices` frame may
    # contain the benchmark ticker (added so equity-curve math works) and the
    # trend-filter defensive asset (TLT/BIL). Passing the wider frame to
    # equal_weight / momentum / low_vol would make those strategies hold the
    # benchmark as a portfolio asset, which is incorrect.
    universe_prices = prices[[c for c in universe_tickers if c in prices.columns]]
    rebalance_positions: list[dict[str, Any]] = []
    if strat == "equal_weight":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _equal_weight(
            universe_prices
        )
    elif strat == "momentum_12_1":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _momentum_12_1(
            universe_prices, top_n
        )
    elif strat == "low_vol":
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _low_vol(
            universe_prices, top_n
        )
    elif strat == "trend_filter":
        assert defensive_ticker is not None
        daily_rets, turnover, rebalance_turnover, rebalance_positions = _trend_filter(
            prices, universe_tickers, bench_col, defensive_ticker, top_n
        )
    else:
        raise ValueError(f"Unsupported baseline strategy: {strat}")

    if on_progress:
        on_progress("rebalance", 60)
    daily_rets = _apply_rebalance_costs(daily_rets, rebalance_turnover, costs_bps)
    daily_rets = _slice_series_to_run_window(daily_rets, run_start, run_end)
    rebalance_turnover = _slice_series_to_run_window(rebalance_turnover, run_start, run_end)
    # Recompute annualized turnover using only run-window rebalances.  The strategy function
    # computed `turnover` over the full warmup+run window; we need the run-window-only figure.
    # exclude_initial=False: the first run-window rebalance is a live trading rebalance, not init.
    turnover = _annualize_turnover_from_rebalances(
        rebalance_turnover, periods_per_year=12.0, exclude_initial=False
    )
    benchmark_rets = _slice_series_to_run_window(
        prices[bench_col].pct_change().fillna(0.0),
        run_start,
        run_end,
    )

    initial_capital = _read_initial_capital(run)
    portfolio = initial_capital * (1.0 + daily_rets).cumprod()
    benchmark = (
        initial_capital * (1.0 + benchmark_rets.reindex(portfolio.index).fillna(0.0)).cumprod()
    )
    rows = _equity_rows(portfolio.index, portfolio, benchmark)

    if on_progress:
        on_progress("metrics", 78)
    # Attach run_id to each position row
    position_rows: list[dict[str, Any]] = [
        {"run_id": run["id"], **p}
        for p in _slice_positions_to_run_window(rebalance_positions, run_start, run_end)
    ]
    metrics = _compute_metrics(daily_rets, turnover)
    return BacktestResult(equity_rows=rows, metrics=metrics, position_rows=position_rows)


def _build_ml_result(
    io: SupabaseIO,
    run: dict[str, Any],
    *,
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    tickers = resolve_universe_symbols(run)
    requested_benchmark = _resolve_run_benchmark_ticker(run)
    if requested_benchmark not in tickers:
        tickers = [requested_benchmark, *tickers]

    warmup_years = int(os.getenv("ML_WARMUP_YEARS", "5"))
    warmup_start = (pd.to_datetime(run["start_date"]) - pd.DateOffset(years=warmup_years)).strftime(
        "%Y-%m-%d"
    )

    if on_progress:
        on_progress("load_data", 15)
    prices = io.fetch_prices_frame(tickers, warmup_start, run["end_date"])
    snapshot_cutoff = _ml_required_snapshot_cutoff(run)
    _validate_ml_snapshot_prices(
        prices,
        required_tickers=tickers,
        required_cutoff=snapshot_cutoff,
    )
    available_columns = set(str(c) for c in prices.columns)

    # Hard guard: ML requires at least one investable (non-benchmark) symbol.
    investable = [t for t in tickers if t != requested_benchmark and t in available_columns]
    if not investable:
        raise ValueError(
            "ML run aborted: no non-benchmark universe symbols are available in price data. "
            "Ingest the selected universe or choose a different universe."
        )
    _ensure_min_history(prices, context=f"run {run['id']} strategy {run['strategy_id']}")

    if on_progress:
        on_progress("features", 30)
    benchmark_ticker = _select_available_benchmark_ticker(requested_benchmark, prices.columns)

    top_n_raw = int(run.get("top_n") or 10)
    top_n_for_ml = max(1, min(top_n_raw, len(investable)))
    if top_n_for_ml < top_n_raw:
        print(
            f"[engine][ml] run={run['id']} top_n clamped {top_n_raw}→{top_n_for_ml} "
            f"(universe has {len(investable)} investable symbols)"
        )

    if on_progress:
        on_progress("train", 75)
    last_train_progress = 75

    def ml_progress(processed_steps: int, total_steps: int) -> None:
        nonlocal last_train_progress
        if not on_progress or total_steps <= 0:
            return
        next_progress = 75 + min(14, int((processed_steps / total_steps) * 14))
        if next_progress <= last_train_progress and processed_steps < total_steps:
            return
        last_train_progress = next_progress
        on_progress("train", next_progress)

    ml = run_walk_forward(
        run_id=run["id"],
        strategy=run["strategy_id"],
        prices=prices,
        start_date=run["start_date"],
        end_date=run["end_date"],
        benchmark_ticker=benchmark_ticker,
        top_n=top_n_for_ml,
        cost_bps=float(run.get("costs_bps") or 10.0),
        initial_capital=_read_initial_capital(run),
        progress_cb=ml_progress,
    )
    model_params = (ml.metadata or {}).get("model_params", {})
    if not isinstance(model_params, dict):
        model_params = {}
    expected_impl = "ridge" if run["strategy_id"] == "ml_ridge" else "lightgbm"
    actual_impl = str(model_params.get("model_impl") or "")
    if actual_impl != expected_impl:
        raise RuntimeError(
            f"ML strategy dispatch mismatch: requested={run['strategy_id']} "
            f"expected_impl={expected_impl} actual_impl={actual_impl or 'n/a'}"
        )
    if len(ml.prediction_rows) == 0:
        raise RuntimeError(
            f"ML strategy {run['strategy_id']} produced no predictions. "
            "Run aborted to avoid silent fallback or degenerate output."
        )
    return BacktestResult(
        equity_rows=ml.equity_rows,
        metrics=ml.metrics,
        feature_rows=ml.feature_rows,
        prediction_rows=ml.prediction_rows,
        model_metadata=ml.metadata,
        position_rows=ml.position_rows,
        run_audit_metadata=_build_price_snapshot_metadata(
            prices,
            required_cutoff=snapshot_cutoff,
        ),
    )


def _run_backtest(
    io: SupabaseIO,
    run: dict[str, Any],
    on_progress: ProgressCallback | None = None,
) -> BacktestResult:
    strategy = run["strategy_id"]
    if strategy in {"equal_weight", "momentum_12_1", "low_vol", "trend_filter"}:
        return _build_baseline_result(io, run, on_progress=on_progress)
    if strategy in {"ml_ridge", "ml_lightgbm"}:
        return _build_ml_result(io, run, on_progress=on_progress)

    raise ValueError(f"Unsupported strategy: {strategy}")
