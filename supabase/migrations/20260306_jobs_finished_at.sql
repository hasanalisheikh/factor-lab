-- =============================================================================
-- Add jobs.finished_at for terminal lifecycle timestamps
-- =============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_finished_at ON jobs (finished_at DESC);
