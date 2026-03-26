"""Data staleness watchdog.

Reads data_state.data_cutoff_date from Supabase and exits non-zero if it is
more than MAX_LAG_TRADING_DAYS behind the last complete trading day.

Run after the nightly ingest job so GitHub's built-in workflow-failure email
fires automatically whenever ingestion stops working.

Usage:
    python -m factorlab_engine.watchdog
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta

from .ingest import _get_current_data_state_cutoff, _get_last_complete_trading_day_utc
from .supabase_io import SupabaseIO

# Alert when data is more than this many trading days behind.
# Allows 1 missed ingest (e.g. a US holiday) before alerting; fires after 2
# consecutive missed ingests.
MAX_LAG_TRADING_DAYS = 1


def _count_trading_days_between(start: str, end: str) -> int:
    """Count weekdays strictly after `start` and up to and including `end`.

    Returns 0 if start >= end.
    """
    cursor = datetime.fromisoformat(start + "T00:00:00+00:00")
    target = datetime.fromisoformat(end + "T00:00:00+00:00")
    count = 0
    while cursor < target:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:  # Mon–Fri
            count += 1
    return count


def main() -> None:
    io = SupabaseIO()
    current_cutoff = _get_current_data_state_cutoff(io)
    expected_cutoff = _get_last_complete_trading_day_utc()

    print(
        f"[watchdog] current_cutoff={current_cutoff or 'none'} "
        f"expected_cutoff={expected_cutoff} max_lag={MAX_LAG_TRADING_DAYS}"
    )

    if not current_cutoff:
        print("[watchdog] FAIL: data_state has no cutoff — ingestion has never succeeded")
        sys.exit(1)

    lag = _count_trading_days_between(current_cutoff, expected_cutoff)
    print(f"[watchdog] lag={lag} trading day(s)")

    if lag > MAX_LAG_TRADING_DAYS:
        print(
            f"[watchdog] FAIL: data is {lag} trading days stale "
            f"(current={current_cutoff}, expected={expected_cutoff})"
        )
        sys.exit(1)

    print(f"[watchdog] OK — data is fresh (lag={lag})")


if __name__ == "__main__":
    main()
