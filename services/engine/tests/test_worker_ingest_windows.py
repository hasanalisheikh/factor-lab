from factorlab_engine.worker import _resolve_incremental_ingest_window


def test_resolve_incremental_ingest_window_skips_only_when_range_is_fully_covered() -> None:
    start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
        "2021-03-11",
        "2026-03-11",
        existing_earliest="2020-01-02",
        existing_latest="2026-03-11",
    )

    assert is_fully_covered is True
    assert start_date == "2026-03-11"
    assert end_date == "2026-03-11"


def test_resolve_incremental_ingest_window_keeps_historical_backfill_when_latest_is_current() -> (
    None
):
    start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
        "2021-03-11",
        "2026-03-11",
        existing_earliest="2025-09-15",
        existing_latest="2026-03-11",
    )

    assert is_fully_covered is False
    assert start_date == "2021-03-11"
    assert end_date == "2025-09-14"


def test_resolve_incremental_ingest_window_advances_to_next_day_for_forward_only_updates() -> None:
    start_date, end_date, is_fully_covered = _resolve_incremental_ingest_window(
        "2026-03-12",
        "2026-03-20",
        existing_earliest="2020-01-02",
        existing_latest="2026-03-11",
    )

    assert is_fully_covered is False
    assert start_date == "2026-03-12"
    assert end_date == "2026-03-20"
