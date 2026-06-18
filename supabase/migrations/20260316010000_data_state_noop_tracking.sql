-- =============================================================================
-- 20260316_data_state_noop_tracking.sql
--
-- Adds last_noop_check_at to data_state so the daily cron can record
-- "checked but no new complete trading day was available" without creating
-- noisy ingest jobs or advancing the cutoff.
--
-- Safe to run standalone: creates data_state (with IF NOT EXISTS) if it hasn't
-- been created yet by 20260318_data_cutoff_mode.sql, then adds the column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. UTC helper (idempotent — used by data_state initializer below)
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
    WHEN iso_dow = 1 THEN utc_date - 3  -- Monday  → Friday
    WHEN iso_dow = 7 THEN utc_date - 2  -- Sunday  → Friday
    WHEN iso_dow = 6 THEN utc_date - 1  -- Saturday→ Friday
    ELSE                     utc_date - 1  -- Tue–Fri → previous weekday
  END
  FROM current_day;
$$;

-- ---------------------------------------------------------------------------
-- 2. Create data_state singleton if it doesn't exist yet
--    (20260318_data_cutoff_mode.sql also creates it; IF NOT EXISTS is safe)
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename   = 'data_state'
      AND policyname  = 'data_state_read'
  ) THEN
    CREATE POLICY "data_state_read" ON public.data_state
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Seed the singleton row if it doesn't exist yet.
-- Uses prices MAX date, capped at the last complete trading day.
INSERT INTO public.data_state (id, data_cutoff_date, last_update_at, update_mode, updated_by)
VALUES (
  1,
  COALESCE(
    (SELECT LEAST(MAX(date), public.last_complete_trading_day_utc(NOW()))
       FROM public.prices),
    public.last_complete_trading_day_utc(NOW())
  ),
  NOW(),
  'manual',
  'migration:20260316_data_state_noop_tracking'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Add last_noop_check_at (the actual purpose of this migration)
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_state
  ADD COLUMN IF NOT EXISTS last_noop_check_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.data_state.last_noop_check_at IS
  'Set by the daily cron when it fires but finds no new complete trading day '
  '(e.g. weekends, holidays, or when the target cutoff already matches the '
  'stored cutoff). Distinct from last_update_at, which only advances on a '
  'real ingest batch that successfully finalized new rows.';
