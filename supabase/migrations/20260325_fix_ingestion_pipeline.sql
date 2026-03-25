-- =============================================================================
-- 20260325_fix_ingestion_pipeline.sql
--
-- Fixes a circular dependency that caused data_state.data_cutoff_date to stay
-- frozen for 12+ days.
--
-- Root causes addressed:
--
-- 1. upsert_ticker_stats (from 20260318_data_cutoff_mode.sql) capped
--    ticker_stats.last_date at data_state.data_cutoff_date:
--
--      FROM public.prices p WHERE p.ticker = p_ticker AND p.date <= v_cutoff_date
--
--    This meant ticker_stats.last_date could never advance beyond the stale
--    cutoff, preventing the self-heal path from detecting already-current data.
--    This migration replaces it with the uncapped SQL version (as in 20260317)
--    so last_date reflects actual prices coverage.
--
-- 2. The refresh cron has a self-heal path (added in refresh.ts) that reads
--    ticker_stats.last_date to detect when prices already cover the target
--    cutoff. That path was inert while ticker_stats was capped. Fixing the
--    function unlocks it.
--
-- 3. data_state.data_cutoff_date is advanced immediately by this migration
--    using the actual minimum benchmark coverage in prices, so "Current
--    Through" is unblocked the instant the migration runs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Replace upsert_ticker_stats with uncapped version
--
--    Identical logic to 20260317_ticker_stats_gap_tracking.sql (SQL language,
--    no date cap) — all columns including coverage_window_days and
--    max_gap_days_window are maintained.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Backfill ticker_stats for every known ticker
--
--    Refreshes last_date (now uncapped) for all tickers.
--    Safe on empty tables — zero iterations.
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
-- 3. Advance data_state.data_cutoff_date to actual benchmark coverage
--
--    Computes the minimum of MAX(prices.date) across all nine benchmark
--    tickers, capped at last_complete_trading_day_utc(NOW()), and updates
--    data_state only when the stored date is stale (less than this value).
--
--    This is the immediate unblock for "Current Through" on the Data page.
-- ---------------------------------------------------------------------------

WITH benchmark_coverage AS (
  SELECT MIN(latest_date) AS min_benchmark_date
  FROM (
    SELECT MAX(date) AS latest_date
    FROM public.prices
    WHERE ticker IN ('SPY', 'QQQ', 'IWM', 'VTI', 'EFA', 'EEM', 'TLT', 'GLD', 'VNQ')
    GROUP BY ticker
    HAVING COUNT(*) > 0
  ) per_ticker
),
target AS (
  SELECT LEAST(
    (SELECT min_benchmark_date FROM benchmark_coverage),
    public.last_complete_trading_day_utc(NOW())
  ) AS new_cutoff
)
UPDATE public.data_state
SET
  data_cutoff_date = (SELECT new_cutoff FROM target),
  last_update_at   = NOW(),
  update_mode      = 'manual',
  updated_by       = 'migration:20260325_fix_ingestion_pipeline'
WHERE id = 1
  AND (SELECT new_cutoff FROM target) IS NOT NULL
  AND data_cutoff_date < (SELECT new_cutoff FROM target);

-- ---------------------------------------------------------------------------
-- 4. Clean up stale blocked jobs for tickers that are now fetchable
--
--    BRK.B jobs were permanently blocked because yfinance rejects dot notation.
--    Migration 20260315 renamed the symbol to BRK-B in the prices/ticker_stats
--    tables, but may have left behind blocked data_ingest_jobs rows with the
--    old symbol still present. Remove them so the next cron batch does not
--    skip them via the "refresh_already_active" guard.
--
--    Also remove blocked jobs for the canonical BRK-B symbol that were created
--    before the rename — they are now retryable since prices use BRK-B.
-- ---------------------------------------------------------------------------

DELETE FROM public.data_ingest_jobs
WHERE symbol IN ('BRK.B')
  AND status = 'blocked';
