-- =============================================================================
-- Data ingest jobs: add job_type + payload to jobs table
-- Run AFTER schema.sql and prior migrations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add job_type column (default 'backtest' to preserve existing rows)
-- ---------------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'backtest';

-- ---------------------------------------------------------------------------
-- 2. Add payload column for job metadata (e.g. {ticker, start_date, end_date})
-- ---------------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payload JSONB;

-- ---------------------------------------------------------------------------
-- 3. RLS: allow authenticated users to read data_ingest jobs
--    (existing jobs_select policy requires a run_id → runs join which
--     fails for data_ingest jobs that have no run_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "jobs_data_ingest_select" ON jobs;
CREATE POLICY "jobs_data_ingest_select" ON jobs
  FOR SELECT TO authenticated
  USING (job_type = 'data_ingest');
