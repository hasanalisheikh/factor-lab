-- =============================================================================
-- 20260317_ticker_stats_gap_tracking.sql
--
-- Adds max_gap_days_window to ticker_stats so the /data page health verdict
-- can use multi-metric thresholds (trueMissingRate + maxGapDays + freshnessDays)
-- instead of plain completeness %.
--
-- New column:
--   max_gap_days_window INT DEFAULT 0
--     Max calendar-day gap between consecutive price rows within the coverage
--     window (date >= '2015-01-02'). Gaps ≤ 7 calendar days are excluded because
--     they are explained by weekends + market holidays (Friday→Monday = 3 days,
--     a long holiday = 4 days; > 7 = real data gap).
--
--     Calendar-day → trading-day mapping for thresholds:
--       ≤ 7 cal days  → ≤ 5 trading days → GOOD
--       8–28 cal days → 6–20 trading days → WARNING
--       > 28 cal days → > 20 trading days → DEGRADED
-- =============================================================================

-- ── 1. Add column (idempotent) ────────────────────────────────────────────────

ALTER TABLE public.ticker_stats
  ADD COLUMN IF NOT EXISTS max_gap_days_window INT NOT NULL DEFAULT 0;

-- ── 2. Replace upsert_ticker_stats to compute max_gap_days_window ─────────────
-- Still a single-ticker scan using idx_prices_ticker_date.
-- The gap subquery uses LEAD() over the indexed date column — no full sort.

CREATE OR REPLACE FUNCTION public.upsert_ticker_stats(p_ticker TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.ticker_stats (
    symbol,
    first_date,
    last_date,
    distinct_days,
    row_count,
    coverage_window_days,
    max_gap_days_window,
    last_checked_at,
    updated_at
  )
  SELECT
    p_ticker,
    MIN(date),
    MAX(date),
    COUNT(DISTINCT date),
    COUNT(*),
    COUNT(*) FILTER (WHERE date >= '2015-01-02'),
    COALESCE(
      (
        SELECT MAX(next_dt - date)::INT
        FROM (
          SELECT
            date,
            LEAD(date) OVER (ORDER BY date) AS next_dt
          FROM public.prices
          WHERE ticker = p_ticker
            AND date >= '2015-01-02'
        ) gaps
        WHERE next_dt IS NOT NULL
          AND next_dt - date > 7
      ),
      0
    ),
    NOW(),
    NOW()
  FROM public.prices
  WHERE ticker = p_ticker
  ON CONFLICT (symbol) DO UPDATE SET
    first_date            = EXCLUDED.first_date,
    last_date             = EXCLUDED.last_date,
    distinct_days         = EXCLUDED.distinct_days,
    row_count             = EXCLUDED.row_count,
    coverage_window_days  = EXCLUDED.coverage_window_days,
    max_gap_days_window   = EXCLUDED.max_gap_days_window,
    last_checked_at       = NOW(),
    updated_at            = NOW();
$$;

-- ── 3. Backfill existing rows ─────────────────────────────────────────────────
-- Calls upsert_ticker_stats for every existing ticker_stats row so
-- max_gap_days_window is populated immediately after migration.
-- Safe on empty table (zero iterations).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT symbol FROM public.ticker_stats LOOP
    PERFORM public.upsert_ticker_stats(r.symbol);
  END LOOP;
END $$;
