-- FactorLab MVP Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── runs ────────────────────────────────────────────────────────────────────
CREATE TABLE runs (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT        NOT NULL,
  strategy_id  TEXT        NOT NULL
                           CHECK (strategy_id IN ('equal_weight', 'momentum_12_1', 'ml_ridge', 'ml_lightgbm')),
  status       TEXT        NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  start_date   DATE        NOT NULL,
  end_date     DATE        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── run_metrics ─────────────────────────────────────────────────────────────
-- One row per run. Kept separate so metrics can be written once the run ends.
CREATE TABLE run_metrics (
  id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id         UUID    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  cagr           NUMERIC NOT NULL,
  sharpe         NUMERIC NOT NULL,
  max_drawdown   NUMERIC NOT NULL,  -- stored as negative fraction, e.g. -0.15
  turnover       NUMERIC NOT NULL,
  volatility     NUMERIC NOT NULL,
  win_rate       NUMERIC NOT NULL,
  profit_factor  NUMERIC NOT NULL,
  calmar         NUMERIC NOT NULL,
  UNIQUE (run_id)
);

-- ─── equity_curve ────────────────────────────────────────────────────────────
CREATE TABLE equity_curve (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id     UUID    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  date       DATE    NOT NULL,
  portfolio  NUMERIC NOT NULL,   -- portfolio NAV (starting at 100 000)
  benchmark  NUMERIC NOT NULL,   -- benchmark NAV (e.g. SPY)
  UNIQUE (run_id, date)
);

-- ─── reports ────────────────────────────────────────────────────────────────
-- One HTML tearsheet per run.
CREATE TABLE reports (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id        UUID        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  storage_path  TEXT        NOT NULL,
  url           TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id)
);

-- ─── jobs ────────────────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id      UUID        REFERENCES runs(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress    INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  started_at  TIMESTAMPTZ,
  duration    INTEGER,            -- wall-clock seconds
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── prices ──────────────────────────────────────────────────────────────────
CREATE TABLE prices (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker      TEXT        NOT NULL,
  date        DATE        NOT NULL,
  adj_close   NUMERIC     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date)
);

-- ─── data_last_updated (optional ingestion log) ─────────────────────────────
CREATE TABLE data_last_updated (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  source              TEXT        NOT NULL UNIQUE,
  tickers_ingested    INTEGER     NOT NULL DEFAULT 0,
  rows_upserted       INTEGER     NOT NULL DEFAULT 0,
  start_date          DATE,
  end_date            DATE,
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── features_monthly ────────────────────────────────────────────────────────
CREATE TABLE features_monthly (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker        TEXT        NOT NULL,
  date          DATE        NOT NULL,
  momentum      NUMERIC     NOT NULL,
  reversal      NUMERIC     NOT NULL,
  volatility    NUMERIC     NOT NULL,
  beta          NUMERIC     NOT NULL,
  drawdown      NUMERIC     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date)
);

-- ─── model_metadata ──────────────────────────────────────────────────────────
CREATE TABLE model_metadata (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id              UUID        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  model_name          TEXT        NOT NULL,
  train_start         DATE,
  train_end           DATE,
  train_rows          INTEGER     NOT NULL DEFAULT 0,
  prediction_rows     INTEGER     NOT NULL DEFAULT 0,
  rebalance_count     INTEGER     NOT NULL DEFAULT 0,
  top_n               INTEGER     NOT NULL DEFAULT 10,
  cost_bps            NUMERIC     NOT NULL DEFAULT 10,
  feature_columns     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  feature_importance  JSONB       NOT NULL DEFAULT '{}'::JSONB,
  model_params        JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id)
);

-- ─── model_predictions ───────────────────────────────────────────────────────
CREATE TABLE model_predictions (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id            UUID        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  model_name        TEXT        NOT NULL,
  as_of_date        DATE        NOT NULL,
  target_date       DATE        NOT NULL,
  ticker            TEXT        NOT NULL,
  predicted_return  NUMERIC     NOT NULL,
  realized_return   NUMERIC,
  rank              INTEGER     NOT NULL,
  selected          BOOLEAN     NOT NULL DEFAULT false,
  weight            NUMERIC     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, model_name, as_of_date, ticker)
);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Allow anonymous reads so the UI works with the anon key.
-- Tighten these policies when you add auth.
ALTER TABLE runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_curve ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_last_updated ENABLE ROW LEVEL SECURITY;
ALTER TABLE features_monthly  ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_metadata    ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read"   ON runs         FOR SELECT USING (true);
CREATE POLICY "public read"   ON run_metrics  FOR SELECT USING (true);
CREATE POLICY "public read"   ON equity_curve FOR SELECT USING (true);
CREATE POLICY "public read"   ON reports      FOR SELECT USING (true);
CREATE POLICY "public read"   ON jobs         FOR SELECT USING (true);
CREATE POLICY "public read"   ON prices       FOR SELECT USING (true);
CREATE POLICY "public read"   ON data_last_updated FOR SELECT USING (true);
CREATE POLICY "public read"   ON features_monthly  FOR SELECT USING (true);
CREATE POLICY "public read"   ON model_metadata    FOR SELECT USING (true);
CREATE POLICY "public read"   ON model_predictions FOR SELECT USING (true);
-- Allow the UI to create runs and jobs
CREATE POLICY "public insert" ON runs         FOR INSERT WITH CHECK (true);
CREATE POLICY "public insert" ON jobs         FOR INSERT WITH CHECK (true);

-- ─── Migration (existing databases) ──────────────────────────────────────────
-- If your DB was created before Phase 4, run this in the Supabase SQL Editor:
--
-- ALTER TABLE jobs ADD COLUMN IF NOT EXISTS
--   run_id UUID REFERENCES runs(id) ON DELETE CASCADE;
--
-- CREATE POLICY "public insert" ON runs FOR INSERT WITH CHECK (true);
-- CREATE POLICY "public insert" ON jobs FOR INSERT WITH CHECK (true);
