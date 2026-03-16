-- -----------------------------------------------------------------------------
-- Strict per-user isolation for runs, jobs, notifications, and run-linked data.
-- This migration is idempotent and intentionally keeps legacy NULL-owner rows
-- invisible instead of deleting them.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Ownership columns / compatibility backfills
-- -----------------------------------------------------------------------------

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_runs_user_id
  ON public.runs (user_id);

CREATE INDEX IF NOT EXISTS idx_runs_user_id_created_at
  ON public.runs (user_id, created_at DESC);

DO $$
BEGIN
  IF to_regclass('public.data_ingest_jobs') IS NOT NULL THEN
    ALTER TABLE public.data_ingest_jobs
      ADD COLUMN IF NOT EXISTS requested_by_run_id UUID REFERENCES public.runs(id) ON DELETE SET NULL;

    ALTER TABLE public.data_ingest_jobs
      ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

    ALTER TABLE public.data_ingest_jobs
      ADD COLUMN IF NOT EXISTS request_mode TEXT;

    CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_requested_by_user_id
      ON public.data_ingest_jobs (requested_by_user_id)
      WHERE requested_by_user_id IS NOT NULL;

    UPDATE public.data_ingest_jobs dij
    SET requested_by_user_id = r.user_id
    FROM public.runs r
    WHERE dij.requested_by_run_id = r.id
      AND r.user_id IS NOT NULL
      AND dij.requested_by_user_id IS DISTINCT FROM r.user_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id     UUID        REFERENCES public.runs(id) ON DELETE SET NULL,
  job_id     UUID        REFERENCES public.jobs(id) ON DELETE SET NULL,
  title      TEXT        NOT NULL,
  body       TEXT,
  level      TEXT        NOT NULL DEFAULT 'info'
                         CHECK (level IN ('info', 'success', 'warning', 'error')),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.runs(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS body TEXT;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS level TEXT;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.notifications
SET level = COALESCE(NULLIF(level, ''), 'info');

UPDATE public.notifications
SET title = COALESCE(NULLIF(title, ''), 'Notification')
WHERE title IS NULL OR title = '';

ALTER TABLE public.notifications
  ALTER COLUMN title SET NOT NULL;

ALTER TABLE public.notifications
  ALTER COLUMN level SET DEFAULT 'info';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_level_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_level_check
  CHECK (level IN ('info', 'success', 'warning', 'error'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE user_id IS NULL
  ) THEN
    ALTER TABLE public.notifications
      ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS cleanup: remove permissive policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "public read" ON public.runs;
DROP POLICY IF EXISTS "public read" ON public.run_metrics;
DROP POLICY IF EXISTS "public read" ON public.equity_curve;
DROP POLICY IF EXISTS "public read" ON public.reports;
DROP POLICY IF EXISTS "public read" ON public.jobs;
DROP POLICY IF EXISTS "public read" ON public.positions;
DROP POLICY IF EXISTS "public read" ON public.model_metadata;
DROP POLICY IF EXISTS "public read" ON public.model_predictions;
DROP POLICY IF EXISTS "jobs_data_ingest_select" ON public.jobs;

DROP POLICY IF EXISTS "runs_select" ON public.runs;
DROP POLICY IF EXISTS "runs_insert" ON public.runs;
DROP POLICY IF EXISTS "runs_update" ON public.runs;
DROP POLICY IF EXISTS "runs_delete" ON public.runs;
DROP POLICY IF EXISTS "rm_select" ON public.run_metrics;
DROP POLICY IF EXISTS "ec_select" ON public.equity_curve;
DROP POLICY IF EXISTS "rpt_select" ON public.reports;
DROP POLICY IF EXISTS "jobs_select" ON public.jobs;
DROP POLICY IF EXISTS "jobs_insert" ON public.jobs;
DROP POLICY IF EXISTS "jobs_update" ON public.jobs;
DROP POLICY IF EXISTS "jobs_delete" ON public.jobs;
DROP POLICY IF EXISTS "pos_select" ON public.positions;
DROP POLICY IF EXISTS "mm_select" ON public.model_metadata;
DROP POLICY IF EXISTS "mp_select" ON public.model_predictions;

DO $$
BEGIN
  IF to_regclass('public.data_ingest_jobs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "data_ingest_jobs_auth_read" ON public.data_ingest_jobs;
    DROP POLICY IF EXISTS "data_ingest_jobs_select" ON public.data_ingest_jobs;
    DROP POLICY IF EXISTS "data_ingest_jobs_insert" ON public.data_ingest_jobs;
    DROP POLICY IF EXISTS "data_ingest_jobs_update" ON public.data_ingest_jobs;
    DROP POLICY IF EXISTS "data_ingest_jobs_delete" ON public.data_ingest_jobs;
  END IF;
END $$;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;

-- -----------------------------------------------------------------------------
-- RLS: owner-only access for user data
-- -----------------------------------------------------------------------------

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equity_curve ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runs_select" ON public.runs
  FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "runs_insert" ON public.runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "runs_update" ON public.runs
  FOR UPDATE TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "runs_delete" ON public.runs
  FOR DELETE TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "rm_select" ON public.run_metrics
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.run_metrics.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "ec_select" ON public.equity_curve
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.equity_curve.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "rpt_select" ON public.reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.reports.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "jobs_select" ON public.jobs
  FOR SELECT TO authenticated
  USING (
    run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.jobs.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "jobs_insert" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.jobs.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "jobs_update" ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.jobs.run_id
        AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.jobs.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "jobs_delete" ON public.jobs
  FOR DELETE TO authenticated
  USING (
    run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.jobs.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "pos_select" ON public.positions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.positions.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "mm_select" ON public.model_metadata
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.model_metadata.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "mp_select" ON public.model_predictions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      WHERE r.id = public.model_predictions.run_id
        AND r.user_id = auth.uid()
    )
  );

DO $$
BEGIN
  IF to_regclass('public.data_ingest_jobs') IS NOT NULL THEN
    ALTER TABLE public.data_ingest_jobs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "data_ingest_jobs_select" ON public.data_ingest_jobs
      FOR SELECT TO authenticated
      USING (
        (requested_by_user_id IS NOT NULL AND requested_by_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.runs r
          WHERE r.id = public.data_ingest_jobs.requested_by_run_id
            AND r.user_id = auth.uid()
        )
        OR (
          requested_by_user_id IS NULL
          AND requested_by_run_id IS NULL
          AND COALESCE(request_mode, '') IN ('monthly', 'daily')
        )
      );

    CREATE POLICY "data_ingest_jobs_insert" ON public.data_ingest_jobs
      FOR INSERT TO authenticated
      WITH CHECK (
        (requested_by_user_id IS NOT NULL AND requested_by_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.runs r
          WHERE r.id = public.data_ingest_jobs.requested_by_run_id
            AND r.user_id = auth.uid()
        )
      );

    CREATE POLICY "data_ingest_jobs_update" ON public.data_ingest_jobs
      FOR UPDATE TO authenticated
      USING (
        (requested_by_user_id IS NOT NULL AND requested_by_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.runs r
          WHERE r.id = public.data_ingest_jobs.requested_by_run_id
            AND r.user_id = auth.uid()
        )
      )
      WITH CHECK (
        (requested_by_user_id IS NOT NULL AND requested_by_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.runs r
          WHERE r.id = public.data_ingest_jobs.requested_by_run_id
            AND r.user_id = auth.uid()
        )
      );

    CREATE POLICY "data_ingest_jobs_delete" ON public.data_ingest_jobs
      FOR DELETE TO authenticated
      USING (
        (requested_by_user_id IS NOT NULL AND requested_by_user_id = auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.runs r
          WHERE r.id = public.data_ingest_jobs.requested_by_run_id
            AND r.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());
