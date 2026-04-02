-- =============================================================================
-- 20260403_fix_upsert_ticker_stats_cutoff.sql
--
-- upsert_ticker_stats was capping ticker_stats.last_date at
-- data_state.data_cutoff_date (frozen at March 2025 since the 20260318
-- migration).  Even after preflight repair jobs ingested fresh prices the
-- stats stayed at March 2025, causing the preflight coverage check to
-- perpetually flag every ticker as stale and re-trigger repairs indefinitely.
--
-- Fix: remove the data_cutoff_date filter so ticker_stats reflects the
-- actual dates in the prices table.  data_cutoff_date still controls the
-- aggregate health display (get_data_health_agg / get_ticker_day_counts).
--
-- Also advances data_cutoff_date to the current last-complete trading day so
-- the /data page health aggregate is no longer frozen in the past.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rewrite upsert_ticker_stats without the data_cutoff_date cap
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_ticker_stats(p_ticker TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_first_date DATE;
  v_last_date DATE;
  v_distinct_days BIGINT;
  v_row_count BIGINT;
  v_coverage_window_days BIGINT;
  v_max_gap_days_window INT;
BEGIN
  SELECT
    MIN(p.date),
    MAX(p.date),
    COUNT(DISTINCT p.date),
    COUNT(*),
    COUNT(*) FILTER (WHERE p.date >= DATE '2015-01-02'),
    COALESCE(
      (
        SELECT MAX(
          (g.next_dt - g.date)
        )::INT
        FROM (
          SELECT
            p2.date,
            LEAD(p2.date) OVER (ORDER BY p2.date) AS next_dt
          FROM public.prices p2
          WHERE p2.ticker = p_ticker
            AND p2.date >= DATE '2015-01-02'
        ) g
        WHERE g.next_dt IS NOT NULL
          AND g.next_dt - g.date > 7
      ),
      0
    )
  INTO
    v_first_date,
    v_last_date,
    v_distinct_days,
    v_row_count,
    v_coverage_window_days,
    v_max_gap_days_window
  FROM public.prices p
  WHERE p.ticker = p_ticker;

  IF COALESCE(v_row_count, 0) = 0 THEN
    DELETE FROM public.ticker_stats
    WHERE symbol = p_ticker;
    RETURN;
  END IF;

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
  VALUES (
    p_ticker,
    v_first_date,
    v_last_date,
    v_distinct_days,
    v_row_count,
    v_coverage_window_days,
    v_max_gap_days_window,
    NOW(),
    NOW()
  )
  ON CONFLICT (symbol) DO UPDATE SET
    first_date           = EXCLUDED.first_date,
    last_date            = EXCLUDED.last_date,
    distinct_days        = EXCLUDED.distinct_days,
    row_count            = EXCLUDED.row_count,
    coverage_window_days = EXCLUDED.coverage_window_days,
    max_gap_days_window  = EXCLUDED.max_gap_days_window,
    last_checked_at      = NOW(),
    updated_at           = NOW();
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Refresh ticker_stats now that the cap is removed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT ticker FROM public.prices LOOP
    PERFORM public.upsert_ticker_stats(r.ticker);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Advance data_cutoff_date to the last complete trading day
--    (was frozen at the max prices.date when 20260318 first ran)
-- ---------------------------------------------------------------------------
UPDATE public.data_state
SET
  data_cutoff_date = public.last_complete_trading_day_utc(NOW()),
  last_update_at   = NOW(),
  updated_by       = 'migration:20260403_fix_upsert_ticker_stats_cutoff'
WHERE id = 1;
