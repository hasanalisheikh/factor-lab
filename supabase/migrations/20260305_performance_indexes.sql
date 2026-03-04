-- Performance indexes for common query patterns
-- runs.user_id: used in RLS policy evaluation (USING user_id = auth.uid()) on every runs SELECT
-- runs.status + created_at: used in filtered list queries and ORDER BY
-- Composite (user_id, created_at) covers the most common pattern: filter by user, sort by date

CREATE INDEX IF NOT EXISTS idx_runs_user_id
  ON runs (user_id);

CREATE INDEX IF NOT EXISTS idx_runs_user_id_created_at
  ON runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs (status);

-- equity_curve: UNIQUE(run_id, date) already exists, but an explicit index on run_id alone
-- helps for non-date-filtered fetches like getEquityCurve(id)
-- (Postgres can use the composite unique index for run_id prefix scans, so this may be redundant
--  but makes the plan explicit)
CREATE INDEX IF NOT EXISTS idx_equity_curve_run_id
  ON equity_curve (run_id);

-- jobs: UNIQUE(run_id) already covers single-run lookups; add created_at for list queries
CREATE INDEX IF NOT EXISTS idx_jobs_created_at
  ON jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_status
  ON jobs (status);
