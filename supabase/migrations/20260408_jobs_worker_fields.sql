-- Add worker identity and explicit heartbeat timestamp to the backtest jobs table.
--
-- claimed_at  : timestamp when this job was first claimed by a worker (set once at claim
--               time, never updated — distinguishes "just claimed" from "heartbeat alive").
-- worker_id   : hostname:pid of the worker process that claimed the job (for debugging
--               multi-worker deployments and correlating logs).
-- heartbeat_at: updated every 10 s by the _Heartbeat background thread ONLY (not on
--               progress changes). Allows stall detection to distinguish "job is progressing
--               but slow" from "heartbeat has gone silent", independent of updated_at which
--               is overloaded by progress writes.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS claimed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id    TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

-- Partial index: used by stall-detection queries that scan running jobs by heartbeat_at.
CREATE INDEX IF NOT EXISTS idx_jobs_running_heartbeat_at
  ON jobs (heartbeat_at)
  WHERE status = 'running';
