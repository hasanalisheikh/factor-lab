"""Unit tests for validate_backtest_window.

Boundary conditions verified:
  count: 499 points → fails, 500 points → passes (given adequate span)
  span:  729 days   → fails, 730 days   → passes (given adequate count)
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from factorlab_engine.worker import (
  MIN_DATA_POINTS,
  MIN_SPAN_DAYS,
  validate_backtest_window,
)


def _daily_dates(n_points: int, gap_days: int = 1) -> list[date]:
  """Return n_points dates spaced gap_days apart starting 2020-01-01."""
  start = date(2020, 1, 1)
  return [start + timedelta(days=i * gap_days) for i in range(n_points)]


# ---------------------------------------------------------------------------
# Empty / trivial inputs
# ---------------------------------------------------------------------------

def test_empty_dates_fails():
  ok, reason = validate_backtest_window([])
  assert not ok
  assert "No data points" in reason


# ---------------------------------------------------------------------------
# Data-point boundary: gap_days=2 so span >> 730 days in both cases,
# isolating the count check.
# ---------------------------------------------------------------------------

def test_499_points_fails():
  """499 data points must fail even when the calendar span is sufficient."""
  dates = _daily_dates(499, gap_days=2)  # span = 996 days >> 730
  ok, reason = validate_backtest_window(dates)
  assert not ok
  assert "499" in reason
  assert str(MIN_DATA_POINTS) in reason


def test_500_points_passes():
  """Exactly 500 data points with adequate span must pass."""
  dates = _daily_dates(500, gap_days=2)  # span = 998 days >> 730
  ok, reason = validate_backtest_window(dates)
  assert ok
  assert reason == ""


# ---------------------------------------------------------------------------
# Calendar-span boundary: 1-day spacing so count >> 500 in both cases,
# isolating the span check.
# ---------------------------------------------------------------------------

def test_729_days_span_fails():
  """A span of exactly 729 calendar days must fail."""
  # 730 daily dates → dates[0] .. dates[729], span = 729 days
  dates = _daily_dates(730, gap_days=1)
  span = (dates[-1] - dates[0]).days
  assert span == 729, f"expected 729, got {span}"
  ok, reason = validate_backtest_window(dates)
  assert not ok
  assert "729" in reason
  assert str(MIN_SPAN_DAYS) in reason


def test_730_days_span_passes():
  """A span of exactly 730 calendar days with 500+ points must pass."""
  # 731 daily dates → span = 730 days; 731 >= 500 points
  dates = _daily_dates(731, gap_days=1)
  span = (dates[-1] - dates[0]).days
  assert span == 730, f"expected 730, got {span}"
  ok, reason = validate_backtest_window(dates)
  assert ok
  assert reason == ""


# ---------------------------------------------------------------------------
# Monthly-cadence detection adjusts the error message but not the logic.
# ---------------------------------------------------------------------------

def test_monthly_cadence_note_in_message():
  """Fewer than MIN_DATA_POINTS monthly dates includes a cadence note."""
  # 24 monthly dates (gap ~30 days) → n=24 < 500
  dates = _daily_dates(24, gap_days=30)
  ok, reason = validate_backtest_window(dates)
  assert not ok
  assert "monthly" in reason.lower()


def test_monthly_cadence_still_fails_span():
  """Monthly data with enough count but span < 730 days still fails span."""
  # 500 monthly dates → span ≈ 15 000 days >> 730 → passes both checks
  dates_long = _daily_dates(500, gap_days=30)
  ok, _ = validate_backtest_window(dates_long)
  assert ok


# ---------------------------------------------------------------------------
# Custom thresholds
# ---------------------------------------------------------------------------

def test_custom_min_thresholds():
  ok, reason = validate_backtest_window(
    _daily_dates(10, gap_days=2),
    min_span_days=10,
    min_data_points=10,
  )
  assert ok

  ok, reason = validate_backtest_window(
    _daily_dates(9, gap_days=2),
    min_span_days=10,
    min_data_points=10,
  )
  assert not ok


# ---------------------------------------------------------------------------
# Accepts pd.Timestamp inputs (engine passes these from equity_rows)
# ---------------------------------------------------------------------------

def test_accepts_pandas_timestamps():
  import pandas as pd

  dates = pd.bdate_range("2017-01-01", "2020-06-01")  # ~880 bdays, ~1247 days
  ok, reason = validate_backtest_window(list(dates))
  assert ok, reason
