-- =============================================================================
-- Auto Data Coverage: preflight check before backtest enqueue
--
-- Changes:
--   1. runs.status  — add 'waiting_for_data' value
--   2. runs         — add executed_with_missing_data boolean
--   3. jobs         — add preflight_run_id (links ingest job → waiting run)
-- =============================================================================

-- ── 1. Extend runs.status to include 'waiting_for_data' ─────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runs_status_check'
      AND conrelid = 'runs'::regclass
  ) THEN
    ALTER TABLE runs DROP CONSTRAINT runs_status_check;
  END IF;
END $$;

ALTER TABLE runs
  ADD CONSTRAINT runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'waiting_for_data'));

-- ── 2. Add executed_with_missing_data flag ───────────────────────────────────
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS executed_with_missing_data BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Add preflight_run_id to jobs ─────────────────────────────────────────
-- Links a data_ingest job to the run that is waiting for it.
-- ON DELETE CASCADE so cleanup is automatic when a run is deleted.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS preflight_run_id UUID REFERENCES runs(id) ON DELETE CASCADE;

-- Index for fast "find all preflight jobs for run X" lookups used by chaining.
CREATE INDEX IF NOT EXISTS jobs_preflight_run_id_idx
  ON jobs (preflight_run_id)
  WHERE preflight_run_id IS NOT NULL;
