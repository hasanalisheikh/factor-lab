-- =============================================================================
-- Heartbeat timestamp and retry counter for jobs
--
-- Problem: when the worker process crashes mid-job, the job row stays in
-- status='running' indefinitely because there is no timestamp written while
-- the job is alive. Users see "Downloading…" forever in the UI.
--
-- Solution:
--   1. jobs.updated_at — written by the worker on every progress update AND by
--      a 15-second background heartbeat thread; stale = no update in N minutes.
--   2. jobs.attempt_count — incremented on each auto-requeue so we cap retries
--      at 3 attempts before permanently marking the job failed.
--   3. Partial index on (updated_at) WHERE status='running' — makes the stall
--      scan O(running jobs) not O(all jobs).
-- =============================================================================

-- ── 1. Add updated_at (heartbeat timestamp) ──────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows so that old running jobs don't instantly appear stalled
-- the moment this migration is deployed.
UPDATE jobs
  SET updated_at = COALESCE(started_at, created_at)
  WHERE updated_at IS NULL;

-- ── 2. Add attempt_count (retry counter) ─────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- ── 3. Partial index for fast stall scan ─────────────────────────────────────
-- Only indexes rows WHERE status='running' — keeps the index tiny.
-- Used by scan_and_requeue_stalled_jobs() to find stalled jobs efficiently.
CREATE INDEX IF NOT EXISTS jobs_running_updated_at_idx
  ON jobs (updated_at)
  WHERE status = 'running';
