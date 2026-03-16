-- ============================================================================
-- 20260319_data_ingest_rows_inserted.sql
--
-- Persists the number of rows written by each data_ingest_jobs attempt so the
-- UI can treat 0-row ingests as successful, terminal jobs rather than a
-- perpetually-refreshing intermediate state.
-- ============================================================================

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS rows_inserted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS deferred_to_monthly BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.data_ingest_jobs
SET rows_inserted = 0
WHERE rows_inserted IS NULL;

UPDATE public.data_ingest_jobs
SET deferred_to_monthly = FALSE
WHERE deferred_to_monthly IS NULL;

DROP FUNCTION IF EXISTS public.get_latest_data_ingest_jobs(TEXT[]);

CREATE OR REPLACE FUNCTION public.get_latest_data_ingest_jobs(p_symbols TEXT[])
RETURNS TABLE (
  id                  UUID,
  symbol              TEXT,
  start_date          DATE,
  end_date            DATE,
  status              TEXT,
  progress            INTEGER,
  stage               TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  rows_inserted       INTEGER,
  next_retry_at       TIMESTAMPTZ,
  attempt_count       INTEGER,
  requested_by_run_id UUID,
  request_mode        TEXT,
  batch_id            UUID,
  target_cutoff_date  DATE,
  requested_by        TEXT,
  last_heartbeat_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (j.symbol)
    j.id,
    j.symbol,
    j.start_date,
    j.end_date,
    j.status,
    j.progress,
    j.stage,
    j.error,
    j.created_at,
    j.started_at,
    j.updated_at,
    j.finished_at,
    j.rows_inserted,
    j.next_retry_at,
    j.attempt_count,
    j.requested_by_run_id,
    j.request_mode,
    j.batch_id,
    j.target_cutoff_date,
    j.requested_by,
    j.last_heartbeat_at
  FROM public.data_ingest_jobs j
  WHERE j.symbol = ANY(p_symbols)
  ORDER BY j.symbol, j.created_at DESC;
$$;
