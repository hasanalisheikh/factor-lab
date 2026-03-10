-- =============================================================================
-- ticker_stats: cached per-ticker price stats for fast /data page loads
--
-- Problem: get_ticker_date_ranges() does GROUP BY over the entire prices table,
-- causing statement timeouts when prices is large. The /data page called it 3x.
--
-- Solution:
--   1. Composite index on prices(ticker, date) for fast per-ticker aggregation
--   2. ticker_stats table: one row per ticker, updated by Python worker after ingest
--   3. upsert_ticker_stats(ticker): computes stats for ONE ticker only (uses index)
--   4. get_benchmark_coverage_agg(): DB-side GROUP BY for benchmark coverage,
--      returns 1 row per ticker instead of ~25k rows to JS
-- =============================================================================

-- ── 1. Composite index for per-ticker aggregation ────────────────────────────
-- The UNIQUE(ticker, date) constraint already creates an index, but an explicit
-- named index makes query plans predictable and is needed for upsert_ticker_stats.
CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON public.prices (ticker, date);

-- ── 2. ticker_stats cache table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticker_stats (
  symbol        TEXT        PRIMARY KEY,
  first_date    DATE        NOT NULL,
  last_date     DATE        NOT NULL,
  distinct_days BIGINT      NOT NULL DEFAULT 0,
  row_count     BIGINT      NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ticker_stats ENABLE ROW LEVEL SECURITY;

-- Auth-only read (no per-user scoping — shared stats like prices table)
CREATE POLICY "ticker_stats_read" ON public.ticker_stats
  FOR SELECT TO authenticated USING (true);

-- ── 3. upsert_ticker_stats(p_ticker) ─────────────────────────────────────────
-- Computes and upserts stats for a SINGLE ticker using idx_prices_ticker_date.
-- Called by Python worker after every data_ingest job completes.
-- Fast: only scans rows for p_ticker, not the whole table.
CREATE OR REPLACE FUNCTION public.upsert_ticker_stats(p_ticker TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.ticker_stats (symbol, first_date, last_date, distinct_days, row_count, updated_at)
  SELECT
    p_ticker,
    MIN(date),
    MAX(date),
    COUNT(DISTINCT date),
    COUNT(*),
    NOW()
  FROM public.prices
  WHERE ticker = p_ticker
  ON CONFLICT (symbol) DO UPDATE SET
    first_date    = EXCLUDED.first_date,
    last_date     = EXCLUDED.last_date,
    distinct_days = EXCLUDED.distinct_days,
    row_count     = EXCLUDED.row_count,
    updated_at    = NOW();
$$;

-- ── 4. get_benchmark_coverage_agg() ──────────────────────────────────────────
-- Returns per-ticker aggregates for a set of tickers within a date window.
-- Used by getAllBenchmarkCoverage() instead of fetching all rows to JS.
-- Returns 1 row per ticker (vs ~25k rows for 9 benchmarks × 11 years).
CREATE OR REPLACE FUNCTION public.get_benchmark_coverage_agg(
  p_tickers TEXT[],
  p_start   DATE,
  p_end     DATE
)
RETURNS TABLE(ticker TEXT, actual_days BIGINT, earliest_date DATE, latest_date DATE)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    p.ticker,
    COUNT(*)::BIGINT AS actual_days,
    MIN(p.date)      AS earliest_date,
    MAX(p.date)      AS latest_date
  FROM public.prices p
  WHERE p.ticker = ANY(p_tickers)
    AND p.date >= p_start
    AND p.date <= p_end
  GROUP BY p.ticker;
$$;
