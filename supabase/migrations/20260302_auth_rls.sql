-- ─── Auth + RLS migration ────────────────────────────────────────────────────
-- Adds user_id ownership to runs, rewrites all permissive policies to
-- owner-only (authenticated), adds user_settings table.
-- Run in Supabase SQL Editor. Idempotent via IF NOT EXISTS / IF EXISTS guards.

-- ─── 1. Add user_id to runs ──────────────────────────────────────────────────
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─── 2. Drop all existing permissive public-read policies ────────────────────
DROP POLICY IF EXISTS "public read" ON runs;
DROP POLICY IF EXISTS "public read" ON run_metrics;
DROP POLICY IF EXISTS "public read" ON equity_curve;
DROP POLICY IF EXISTS "public read" ON reports;
DROP POLICY IF EXISTS "public read" ON jobs;
DROP POLICY IF EXISTS "public read" ON prices;
DROP POLICY IF EXISTS "public read" ON data_last_updated;
DROP POLICY IF EXISTS "public read" ON features_monthly;
DROP POLICY IF EXISTS "public read" ON model_metadata;
DROP POLICY IF EXISTS "public read" ON model_predictions;
DROP POLICY IF EXISTS "public read" ON positions;

-- Also drop any previously attempted auth policies (idempotent re-runs)
DROP POLICY IF EXISTS "runs_select"  ON runs;
DROP POLICY IF EXISTS "runs_insert"  ON runs;
DROP POLICY IF EXISTS "runs_update"  ON runs;
DROP POLICY IF EXISTS "runs_delete"  ON runs;
DROP POLICY IF EXISTS "rm_select"    ON run_metrics;
DROP POLICY IF EXISTS "ec_select"    ON equity_curve;
DROP POLICY IF EXISTS "rpt_select"   ON reports;
DROP POLICY IF EXISTS "jobs_select"  ON jobs;
DROP POLICY IF EXISTS "pos_select"   ON positions;
DROP POLICY IF EXISTS "mm_select"    ON model_metadata;
DROP POLICY IF EXISTS "mp_select"    ON model_predictions;
DROP POLICY IF EXISTS "prices_read"       ON prices;
DROP POLICY IF EXISTS "features_read"     ON features_monthly;
DROP POLICY IF EXISTS "data_updated_read" ON data_last_updated;

-- ─── 3. runs: full CRUD, owner-only ─────────────────────────────────────────
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runs_select" ON runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "runs_insert" ON runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "runs_update" ON runs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "runs_delete" ON runs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── 4. Child tables: SELECT only, scoped via runs.user_id ───────────────────
-- run_metrics
ALTER TABLE run_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rm_select" ON run_metrics
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = run_metrics.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- equity_curve
ALTER TABLE equity_curve ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ec_select" ON equity_curve
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = equity_curve.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- reports
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rpt_select" ON reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = reports.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- jobs
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = jobs.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- positions
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_select" ON positions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = positions.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- model_metadata
ALTER TABLE model_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mm_select" ON model_metadata
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = model_metadata.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- model_predictions
ALTER TABLE model_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mp_select" ON model_predictions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = model_predictions.run_id
        AND runs.user_id = auth.uid()
    )
  );

-- ─── 5. Shared market-data tables: authenticated reads ───────────────────────
-- No user-scoping: these are shared across all users.
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prices_read" ON prices
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE features_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features_read" ON features_monthly
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE data_last_updated ENABLE ROW LEVEL SECURITY;
CREATE POLICY "data_updated_read" ON data_last_updated
  FOR SELECT TO authenticated
  USING (true);

-- ─── 6. user_settings table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_universe  TEXT        NOT NULL DEFAULT 'ETF8'
                                CHECK (default_universe IN ('ETF8', 'SP100', 'NASDAQ100')),
  default_benchmark TEXT        NOT NULL DEFAULT 'SPY',
  default_costs_bps INTEGER     NOT NULL DEFAULT 10
                                CHECK (default_costs_bps >= 0 AND default_costs_bps <= 500),
  default_top_n     INTEGER     NOT NULL DEFAULT 10
                                CHECK (default_top_n >= 1 AND default_top_n <= 100),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_owner" ON user_settings;
CREATE POLICY "settings_owner" ON user_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
