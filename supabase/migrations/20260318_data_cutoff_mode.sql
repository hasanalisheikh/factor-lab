-- =============================================================================
-- 20260318_data_cutoff_mode.sql
--
-- Introduces a singleton data_state row so the app can treat market data as
-- "current through <cutoff>" instead of constantly chasing the newest rows.
--
-- Also extends data_ingest_jobs with scheduled-refresh metadata so monthly and
-- daily refresh batches can advance the cutoff only after every required ticker
-- succeeds.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. UTC helper: last complete trading day (weekday-only approximation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.last_complete_trading_day_utc(
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  WITH current_day AS (
    SELECT
      (p_now AT TIME ZONE 'UTC')::DATE AS utc_date,
      EXTRACT(ISODOW FROM p_now AT TIME ZONE 'UTC')::INT AS iso_dow
  )
  SELECT CASE
    WHEN iso_dow = 1 THEN utc_date - 3
    WHEN iso_dow = 7 THEN utc_date - 2
    WHEN iso_dow = 6 THEN utc_date - 1
    ELSE utc_date - 1
  END
  FROM current_day;
$$;

-- ---------------------------------------------------------------------------
-- 2. Global cutoff singleton
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_state (
  id               INTEGER     PRIMARY KEY CHECK (id = 1),
  data_cutoff_date DATE        NOT NULL,
  last_update_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_mode      TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (update_mode IN ('monthly', 'daily', 'manual')),
  updated_by       TEXT
);

ALTER TABLE public.data_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'data_state'
      AND policyname = 'data_state_read'
  ) THEN
    CREATE POLICY "data_state_read" ON public.data_state
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

INSERT INTO public.data_state (
  id,
  data_cutoff_date,
  last_update_at,
  update_mode,
  updated_by
)
VALUES (
  1,
  COALESCE(
    (
      SELECT LEAST(
        MAX(date),
        public.last_complete_trading_day_utc(NOW())
      )
      FROM public.prices
    ),
    public.last_complete_trading_day_utc(NOW())
  ),
  NOW(),
  'manual',
  'migration:20260318_data_cutoff_mode'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. data_ingest_jobs: scheduled-refresh metadata + heartbeat column
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS request_mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS target_cutoff_date DATE;

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS requested_by TEXT;

ALTER TABLE public.data_ingest_jobs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.data_ingest_jobs
SET
  request_mode = CASE
    WHEN requested_by_run_id IS NOT NULL THEN 'preflight'
    ELSE 'manual'
  END,
  requested_by = COALESCE(
    requested_by,
    CASE
      WHEN requested_by_run_id IS NOT NULL THEN 'run-preflight'
      ELSE 'manual'
    END
  ),
  target_cutoff_date = COALESCE(target_cutoff_date, end_date),
  last_heartbeat_at = COALESCE(last_heartbeat_at, updated_at, created_at, NOW())
WHERE request_mode NOT IN ('monthly', 'daily', 'manual', 'preflight')
   OR requested_by IS NULL
   OR target_cutoff_date IS NULL
   OR last_heartbeat_at IS NULL;

ALTER TABLE public.data_ingest_jobs
  DROP CONSTRAINT IF EXISTS data_ingest_jobs_status_check;

UPDATE public.data_ingest_jobs
SET status = 'succeeded'
WHERE status = 'completed';

ALTER TABLE public.data_ingest_jobs
  ADD CONSTRAINT data_ingest_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'blocked'));

ALTER TABLE public.data_ingest_jobs
  DROP CONSTRAINT IF EXISTS data_ingest_jobs_request_mode_check;

ALTER TABLE public.data_ingest_jobs
  ADD CONSTRAINT data_ingest_jobs_request_mode_check
  CHECK (request_mode IN ('monthly', 'daily', 'manual', 'preflight'));

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_running_heartbeat
  ON public.data_ingest_jobs(last_heartbeat_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_batch
  ON public.data_ingest_jobs(batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_symbol_mode_target
  ON public.data_ingest_jobs(symbol, request_mode, target_cutoff_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_retrying_due
  ON public.data_ingest_jobs(next_retry_at)
  WHERE status = 'retrying' AND next_retry_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. latest-job RPC: expose new metadata fields
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. ticker_stats: recompute only through the current global cutoff
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_ticker_stats(p_ticker TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cutoff_date DATE;
  v_first_date DATE;
  v_last_date DATE;
  v_distinct_days BIGINT;
  v_row_count BIGINT;
  v_coverage_window_days BIGINT;
  v_max_gap_days_window INT;
BEGIN
  SELECT data_cutoff_date
  INTO v_cutoff_date
  FROM public.data_state
  WHERE id = 1;

  IF v_cutoff_date IS NULL THEN
    v_cutoff_date := public.last_complete_trading_day_utc(NOW());
  END IF;

  SELECT
    MIN(p.date),
    MAX(p.date),
    COUNT(DISTINCT p.date),
    COUNT(*),
    COUNT(*) FILTER (WHERE p.date >= DATE '2015-01-02'),
    COALESCE(
      (
        SELECT MAX(
          (g.next_dt - g.date)
        )::INT
        FROM (
          SELECT
            p2.date,
            LEAD(p2.date) OVER (ORDER BY p2.date) AS next_dt
          FROM public.prices p2
          WHERE p2.ticker = p_ticker
            AND p2.date <= v_cutoff_date
            AND p2.date >= DATE '2015-01-02'
        ) g
        WHERE g.next_dt IS NOT NULL
          AND g.next_dt - g.date > 7
      ),
      0
    )
  INTO
    v_first_date,
    v_last_date,
    v_distinct_days,
    v_row_count,
    v_coverage_window_days,
    v_max_gap_days_window
  FROM public.prices p
  WHERE p.ticker = p_ticker
    AND p.date <= v_cutoff_date;

  IF COALESCE(v_row_count, 0) = 0 THEN
    DELETE FROM public.ticker_stats
    WHERE symbol = p_ticker;
    RETURN;
  END IF;

  INSERT INTO public.ticker_stats (
    symbol,
    first_date,
    last_date,
    distinct_days,
    row_count,
    coverage_window_days,
    max_gap_days_window,
    last_checked_at,
    updated_at
  )
  VALUES (
    p_ticker,
    v_first_date,
    v_last_date,
    v_distinct_days,
    v_row_count,
    v_coverage_window_days,
    v_max_gap_days_window,
    NOW(),
    NOW()
  )
  ON CONFLICT (symbol) DO UPDATE SET
    first_date           = EXCLUDED.first_date,
    last_date            = EXCLUDED.last_date,
    distinct_days        = EXCLUDED.distinct_days,
    row_count            = EXCLUDED.row_count,
    coverage_window_days = EXCLUDED.coverage_window_days,
    max_gap_days_window  = EXCLUDED.max_gap_days_window,
    last_checked_at      = NOW(),
    updated_at           = NOW();
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT ticker FROM public.prices LOOP
    PERFORM public.upsert_ticker_stats(r.ticker);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Aggregate helpers: cap the app-visible max date at the current cutoff
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_data_health_agg()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH cutoff AS (
    SELECT COALESCE(
      (SELECT data_cutoff_date FROM public.data_state WHERE id = 1),
      public.last_complete_trading_day_utc(NOW())
    ) AS cutoff_date
  ),
  visible_prices AS (
    SELECT p.*
    FROM public.prices p
    CROSS JOIN cutoff c
    WHERE p.date <= c.cutoff_date
  )
  SELECT json_build_object(
    'ticker_count', COUNT(DISTINCT visible_prices.ticker),
    'min_date',     MIN(visible_prices.date)::TEXT,
    'max_date',     (SELECT cutoff_date::TEXT FROM cutoff),
    'actual_rows',  COUNT(*)
  )
  FROM visible_prices;
$$;

CREATE OR REPLACE FUNCTION public.get_ticker_day_counts()
RETURNS TABLE(ticker TEXT, actual_days BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH cutoff AS (
    SELECT COALESCE(
      (SELECT data_cutoff_date FROM public.data_state WHERE id = 1),
      public.last_complete_trading_day_utc(NOW())
    ) AS cutoff_date
  )
  SELECT
    p.ticker,
    COUNT(*)::BIGINT AS actual_days
  FROM public.prices p
  CROSS JOIN cutoff c
  WHERE p.date <= c.cutoff_date
  GROUP BY p.ticker
  ORDER BY actual_days ASC;
$$;
