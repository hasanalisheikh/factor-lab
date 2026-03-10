-- ---------------------------------------------------------------------------
-- Migration: dedicated data_ingest_jobs table
--
-- Replaces job_type='data_ingest' rows in the generic jobs table with an
-- explicit-schema table so that symbol/date range columns are queryable,
-- indexable, and type-safe without JSONB payload lookups.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS data_ingest_jobs (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol               TEXT        NOT NULL,
  start_date           DATE        NOT NULL,
  end_date             DATE        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued','running','completed','failed','blocked')),
  progress             INTEGER     NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  stage                TEXT        CHECK (stage IN ('download','transform','upsert','finalize')),
  error                TEXT,
  locked_at            TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count        INTEGER     NOT NULL DEFAULT 0,
  next_retry_at        TIMESTAMPTZ,
  requested_by_run_id  UUID        REFERENCES runs(id) ON DELETE SET NULL,
  requested_by_user_id UUID
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_symbol
  ON data_ingest_jobs(symbol);

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_status_created
  ON data_ingest_jobs(status, created_at);

-- Stall scanner: find running jobs with stale heartbeat
CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_running_updated
  ON data_ingest_jobs(updated_at)
  WHERE status = 'running';

-- Retry scheduler: find failed jobs whose retry window has arrived
CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_retry_due
  ON data_ingest_jobs(next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Preflight chaining: look up ingest jobs for a waiting run
CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_run
  ON data_ingest_jobs(requested_by_run_id)
  WHERE requested_by_run_id IS NOT NULL;

-- RLS: authenticated users can read; service role bypasses RLS for writes
ALTER TABLE data_ingest_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_ingest_jobs_auth_read"
  ON data_ingest_jobs
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- RPC: get_latest_data_ingest_jobs(p_symbols TEXT[])
--
-- Returns the single most-recent data_ingest_job per symbol (by created_at).
-- Used by the /data page instead of fetching up to 50 rows and picking in JS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_latest_data_ingest_jobs(p_symbols TEXT[])
RETURNS TABLE (
  id                UUID,
  symbol            TEXT,
  start_date        DATE,
  end_date          DATE,
  status            TEXT,
  progress          INTEGER,
  stage             TEXT,
  error             TEXT,
  created_at        TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ,
  attempt_count     INTEGER,
  requested_by_run_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (j.symbol)
    j.id, j.symbol, j.start_date, j.end_date,
    j.status, j.progress, j.stage, j.error,
    j.created_at, j.started_at, j.updated_at, j.finished_at,
    j.next_retry_at, j.attempt_count, j.requested_by_run_id
  FROM data_ingest_jobs j
  WHERE j.symbol = ANY(p_symbols)
  ORDER BY j.symbol, j.created_at DESC;
$$;
