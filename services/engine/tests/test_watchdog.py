"""Tests for factorlab_engine.watchdog."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from factorlab_engine.watchdog import MAX_LAG_TRADING_DAYS, _count_trading_days_between, main

# ---------------------------------------------------------------------------
# _count_trading_days_between
# ---------------------------------------------------------------------------


def test_count_same_day_is_zero():
    assert _count_trading_days_between("2026-03-25", "2026-03-25") == 0


def test_count_one_weekday():
    # Wednesday → Thursday = 1
    assert _count_trading_days_between("2026-03-25", "2026-03-26") == 1


def test_count_across_weekend():
    # Friday → Monday = 1 (only Monday counts)
    assert _count_trading_days_between("2026-03-20", "2026-03-23") == 1


def test_count_full_week():
    # Monday → Friday = 4 trading days after Monday = Tue/Wed/Thu/Fri
    assert _count_trading_days_between("2026-03-23", "2026-03-27") == 4


def test_count_two_weeks():
    # Mon Mar 23 → Mon Mar 30 = 5 (Tue/Wed/Thu/Fri/Mon)
    assert _count_trading_days_between("2026-03-23", "2026-03-30") == 5


def test_count_start_after_end_is_zero():
    assert _count_trading_days_between("2026-03-25", "2026-03-20") == 0


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------


def _run_watchdog(current_cutoff: str | None, expected_cutoff: str) -> int:
    """Run main() with mocked dependencies; return the sys.exit code (0 = success)."""
    io_mock = MagicMock()
    exit_code = 0

    def fake_exit(code: int) -> None:
        nonlocal exit_code
        exit_code = code
        raise SystemExit(code)

    with (
        patch("factorlab_engine.watchdog.SupabaseIO", return_value=io_mock),
        patch(
            "factorlab_engine.watchdog._get_current_data_state_cutoff",
            return_value=current_cutoff,
        ),
        patch(
            "factorlab_engine.watchdog._get_last_complete_trading_day_utc",
            return_value=expected_cutoff,
        ),
        patch("sys.exit", side_effect=fake_exit),
    ):
        try:
            main()
        except SystemExit:
            pass

    return exit_code


def test_watchdog_ok_when_current():
    assert _run_watchdog("2026-03-25", "2026-03-25") == 0


def test_watchdog_ok_within_max_lag():
    # lag = 1 = MAX_LAG_TRADING_DAYS → still OK
    assert _run_watchdog("2026-03-24", "2026-03-25") == 0


def test_watchdog_fails_when_too_stale():
    # lag = 2 > MAX_LAG_TRADING_DAYS → fail
    assert _run_watchdog("2026-03-23", "2026-03-25") == 1


def test_watchdog_fails_with_no_cutoff():
    assert _run_watchdog(None, "2026-03-25") == 1


def test_watchdog_fails_when_many_days_stale():
    # 14-day outage
    assert _run_watchdog("2026-03-10", "2026-03-25") == 1


def test_max_lag_constant():
    assert MAX_LAG_TRADING_DAYS == 1
