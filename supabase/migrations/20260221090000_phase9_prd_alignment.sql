-- Phase 9 PRD alignment migration (idempotent)
-- Adds reproducibility fields on runs and richer lifecycle fields on jobs.

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS benchmark_ticker TEXT NOT NULL DEFAULT 'SPY',
  ADD COLUMN IF NOT EXISTS costs_bps NUMERIC NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS top_n INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS run_params JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.runs
  DROP CONSTRAINT IF EXISTS runs_costs_bps_check;
ALTER TABLE public.runs
  ADD CONSTRAINT runs_costs_bps_check CHECK (costs_bps >= 0);

ALTER TABLE public.runs
  DROP CONSTRAINT IF EXISTS runs_top_n_check;
ALTER TABLE public.runs
  ADD CONSTRAINT runs_top_n_check CHECK (top_n > 0);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'ingest',
  ADD COLUMN IF NOT EXISTS error_message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_stage_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_stage_check
      CHECK (stage IN ('ingest', 'features', 'train', 'backtest', 'report'));
  END IF;
END $$;

DROP POLICY IF EXISTS "public insert" ON public.runs;
DROP POLICY IF EXISTS "public insert" ON public.jobs;
