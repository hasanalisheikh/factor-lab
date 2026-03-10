-- Migration: 20260313_ingest_job_state_machine.sql
-- Extends the jobs table with:
--   1. `blocked` terminal status — for invalid-ticker / permanent failures
--   2. `next_retry_at` — exponential backoff scheduling for failed jobs
--   3. `locked_at`     — atomic lease timestamp (set on claim, refreshed by heartbeat)
--   4. Indexes for the retry scheduler and queued-too-long watchdog

-- ---------------------------------------------------------------------------
-- 1. Add `blocked` to the status check constraint
--    Drop any existing status-check constraint (name may vary by PG version),
--    then add the new constraint with the full set of allowed values.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'jobs'
      AND con.contype = 'c'
      AND con.conname LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE jobs DROP CONSTRAINT IF EXISTS %I', c);
  END LOOP;
END $$;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'blocked'));

-- ---------------------------------------------------------------------------
-- 2. next_retry_at — when a failed job should be re-queued by the retry scheduler.
--    NULL means the failure is permanent (no further auto-retries).
-- ---------------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. locked_at — set on claim, refreshed by heartbeat every 15 s.
--    Provides an additional atomic-lease signal beyond status='running'.
-- ---------------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

-- Fast scan for due-for-retry jobs (retry scheduler: status=failed, next_retry_at <= NOW())
CREATE INDEX IF NOT EXISTS jobs_retry_due_idx
  ON jobs (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Fast scan for data_ingest jobs stuck in queued state (queued-too-long watchdog)
CREATE INDEX IF NOT EXISTS jobs_queued_data_ingest_created_idx
  ON jobs (created_at)
  WHERE status = 'queued' AND job_type = 'data_ingest';
