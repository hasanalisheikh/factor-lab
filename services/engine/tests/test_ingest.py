"""Regression tests for factorlab_engine.ingest.

Covers:
- _get_last_complete_trading_day_utc(): weekday/weekend/Monday edge cases
- main(): data_state advancement after successful ingest
- main(): no-op when cutoff is already current
- main(): advances from stale cutoff
- BENCHMARK_TICKERS completeness
- --mode arg propagated to data_state
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock, patch

import pandas as pd

from factorlab_engine.ingest import (
    BENCHMARK_TICKERS,
    _get_last_complete_trading_day_utc,
    main,
)

# ---------------------------------------------------------------------------
# _get_last_complete_trading_day_utc
# ---------------------------------------------------------------------------


def _make_utc(year: int, month: int, day: int, hour: int = 12) -> datetime:
    return datetime(year, month, day, hour, 0, 0, tzinfo=timezone.utc)


def test_get_last_complete_trading_day_tuesday():
    # Tuesday 2026-03-24 → Monday 2026-03-23
    with patch("factorlab_engine.ingest._utcnow", return_value=_make_utc(2026, 3, 24)):
        assert _get_last_complete_trading_day_utc() == "2026-03-23"


def test_get_last_complete_trading_day_monday():
    # Monday 2026-03-23 → Friday 2026-03-20 (skips weekend)
    with patch("factorlab_engine.ingest._utcnow", return_value=_make_utc(2026, 3, 23)):
        assert _get_last_complete_trading_day_utc() == "2026-03-20"


def test_get_last_complete_trading_day_saturday():
    # Saturday 2026-03-21 → Friday 2026-03-20
    with patch("factorlab_engine.ingest._utcnow", return_value=_make_utc(2026, 3, 21)):
        assert _get_last_complete_trading_day_utc() == "2026-03-20"


def test_get_last_complete_trading_day_sunday():
    # Sunday 2026-03-22 → Friday 2026-03-20
    with patch("factorlab_engine.ingest._utcnow", return_value=_make_utc(2026, 3, 22)):
        assert _get_last_complete_trading_day_utc() == "2026-03-20"


def test_get_last_complete_trading_day_friday():
    # Friday 2026-03-27 → Thursday 2026-03-26
    with patch("factorlab_engine.ingest._utcnow", return_value=_make_utc(2026, 3, 27)):
        assert _get_last_complete_trading_day_utc() == "2026-03-26"


# ---------------------------------------------------------------------------
# BENCHMARK_TICKERS completeness
# ---------------------------------------------------------------------------

_ALL_EXPECTED_BENCHMARKS = ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]


def test_all_benchmarks_included():
    for ticker in _ALL_EXPECTED_BENCHMARKS:
        assert ticker in BENCHMARK_TICKERS, f"{ticker} missing from BENCHMARK_TICKERS"


def test_benchmark_tickers_count():
    assert len(BENCHMARK_TICKERS) >= 9


# ---------------------------------------------------------------------------
# Helpers to build fake Supabase client and close DataFrame
# ---------------------------------------------------------------------------


def _make_close_df(start: str = "2026-03-01", end: str = "2026-03-25") -> pd.DataFrame:
    """Return a minimal close-price DataFrame with SPY and QQQ for testing."""
    dates = pd.bdate_range(start, end)
    return pd.DataFrame({"SPY": [500.0] * len(dates), "QQQ": [450.0] * len(dates)}, index=dates)


def _make_fake_supabase() -> MagicMock:
    """Build a minimal mock Supabase client that records upsert/insert/rpc calls."""
    client = MagicMock()
    client.table.return_value.upsert.return_value.execute.return_value = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock()
    return client


# ---------------------------------------------------------------------------
# main() tests
# ---------------------------------------------------------------------------


def _run_main(
    *,
    current_cutoff: str | None,
    close_df: pd.DataFrame,
    mode: str = "daily",
    extra_args: list[str] | None = None,
) -> MagicMock:
    """Invoke main() with mocked Supabase, yfinance, and _utcnow.

    Patches _get_current_data_state_cutoff directly so the test does not need
    to replicate the full Supabase select call chain.

    Returns the fake Supabase client so callers can assert on upsert/rpc calls.
    """
    fake_client = _make_fake_supabase()
    fake_io = MagicMock()
    fake_io.client = fake_client

    argv = ["ingest", "--start-date", "2026-03-01", "--mode", mode]
    if extra_args:
        argv += extra_args

    with (
        patch("factorlab_engine.ingest.SupabaseIO", return_value=fake_io),
        patch("factorlab_engine.ingest._download_prices", return_value=close_df),
        patch(
            "factorlab_engine.ingest._get_current_data_state_cutoff", return_value=current_cutoff
        ),
        patch(
            "factorlab_engine.ingest._utcnow",
            return_value=_make_utc(2026, 3, 26, 21),  # Wednesday 21:00 UTC → target=2026-03-25
        ),
        patch.object(sys, "argv", argv),
    ):
        main()

    return fake_client


def test_main_advances_data_state_after_ingest():
    """Successful ingest with stale cutoff → data_state.data_cutoff_date advances."""
    close = _make_close_df(end="2026-03-25")
    client = _run_main(current_cutoff="2026-03-14", close_df=close)

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 1, "Expected exactly one data_state upsert"
    payload: dict[str, Any] = upsert_calls[0].args[0]
    assert payload["data_cutoff_date"] == "2026-03-25"
    assert payload["update_mode"] == "daily"
    assert "github-actions:ingest:daily" in payload["updated_by"]


def test_main_no_op_when_already_current():
    """If data_state is already at the target date, do not re-upsert it."""
    # target = 2026-03-25 (Wednesday 21:00 UTC), current = 2026-03-25 → no-op
    close = _make_close_df(end="2026-03-25")
    client = _run_main(current_cutoff="2026-03-25", close_df=close)

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 0, "data_state should NOT be upserted when already current"


def test_main_advances_from_stale():
    """Pipeline that has been stale 14 days advances to the correct new cutoff."""
    close = _make_close_df(start="2026-03-01", end="2026-03-25")
    client = _run_main(current_cutoff="2026-03-11", close_df=close)

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 1
    assert upsert_calls[0].args[0]["data_cutoff_date"] == "2026-03-25"


def test_main_no_cutoff_yet_advances():
    """If data_state has no cutoff yet (first run), still advance."""
    close = _make_close_df(end="2026-03-25")
    client = _run_main(current_cutoff=None, close_df=close)

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 1
    assert upsert_calls[0].args[0]["data_cutoff_date"] == "2026-03-25"


def test_mode_arg_propagated_to_data_state():
    """--mode monthly → update_mode='monthly' in data_state upsert."""
    close = _make_close_df(end="2026-03-25")
    client = _run_main(current_cutoff="2026-03-01", close_df=close, mode="monthly")

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 1
    assert upsert_calls[0].args[0]["update_mode"] == "monthly"
    assert "github-actions:ingest:monthly" in upsert_calls[0].args[0]["updated_by"]


def test_main_advances_cutoff_to_today_when_run_after_close():
    """Ingest running after market close (21:00 UTC) advances cutoff to today.

    Wednesday 21:00 UTC: market closed at 20:00 UTC, so today's session (2026-03-26)
    is complete. cutoff must advance to 2026-03-26, not be capped at yesterday (2026-03-25).
    """
    dates = pd.bdate_range("2026-03-01", "2026-03-26")
    close = pd.DataFrame({"SPY": [500.0] * len(dates)}, index=dates)

    client = _run_main(current_cutoff="2026-03-01", close_df=close)

    upsert_calls = [
        c
        for c in client.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict) and c.args[0].get("id") == 1
    ]
    assert len(upsert_calls) == 1
    # Cutoff must reach today (2026-03-26), not be stuck at yesterday (2026-03-25)
    assert upsert_calls[0].args[0]["data_cutoff_date"] == "2026-03-26"


def test_main_calls_upsert_ticker_stats_for_ingested_tickers():
    """After advancing cutoff, upsert_ticker_stats RPC must be called for each ticker."""
    close = _make_close_df(end="2026-03-25")  # columns: SPY, QQQ
    client = _run_main(current_cutoff="2026-03-01", close_df=close)

    rpc_calls = client.rpc.call_args_list
    called_tickers = {
        c.args[1]["p_ticker"] for c in rpc_calls if c.args[0] == "upsert_ticker_stats"
    }
    assert "SPY" in called_tickers
    assert "QQQ" in called_tickers
