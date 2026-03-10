-- =============================================================================
-- 20260316_ticker_coverage_enhancements.sql
--
-- Adds two columns to ticker_stats so getAllBenchmarkCoverage() can read from
-- the cache table instead of calling get_benchmark_coverage_agg (GROUP BY on
-- prices) on every /data page load.
--
-- New columns:
--   coverage_window_days  BIGINT      — COUNT(*) WHERE date >= '2015-01-02'
--                                       (= COVERAGE_WINDOW_START in types.ts)
--                                       Lets TS compute benchmark coverage %
--                                       without scanning prices at all.
--   last_checked_at       TIMESTAMPTZ — when upsert_ticker_stats last ran.
--                                       Reserved for future staleness checks.
--
-- Also adds an index on data_ingest_jobs(started_at) WHERE status='running'
-- so the new max-runtime stall scanner can find hung jobs efficiently.
-- =============================================================================

-- ── 1. Add columns (idempotent) ───────────────────────────────────────────────

ALTER TABLE public.ticker_stats
  ADD COLUMN IF NOT EXISTS coverage_window_days BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.ticker_stats
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- ── 2. Replace upsert_ticker_stats to compute coverage_window_days ───────────
-- Still a single-ticker scan using idx_prices_ticker_date.
-- coverage_window_days uses a filter aggregate — no extra index scan.
-- The constant '2015-01-02' matches COVERAGE_WINDOW_START in lib/supabase/types.ts.

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
    last_checked_at       = NOW(),
    updated_at            = NOW();
$$;

-- ── 3. Backfill existing rows ─────────────────────────────────────────────────
-- Calls upsert_ticker_stats for every existing ticker_stats row so
-- coverage_window_days is populated immediately after migration.
-- Safe on empty table (zero iterations).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT symbol FROM public.ticker_stats LOOP
    PERFORM public.upsert_ticker_stats(r.symbol);
  END LOOP;
END $$;

-- ── 4. Index for max-runtime stall detection ──────────────────────────────────
-- Supports the secondary stall-scanner query:
--   WHERE status = 'running' AND started_at < NOW() - interval '5 minutes'
-- Without this index the query would scan all running jobs.

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_running_started
  ON data_ingest_jobs(started_at)
  WHERE status = 'running';
