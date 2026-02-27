-- Add canonical run-level benchmark column (idempotent).
-- Keeps legacy benchmark_ticker for backward compatibility while promoting
-- runs.benchmark as the source of truth.

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS benchmark TEXT NOT NULL DEFAULT 'SPY';

-- Backfill any null/empty values from benchmark_ticker when present.
UPDATE public.runs
SET benchmark = COALESCE(NULLIF(UPPER(benchmark_ticker), ''), 'SPY')
WHERE benchmark IS NULL OR benchmark = '';
