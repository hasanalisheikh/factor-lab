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

-- ─── jobs ────────────────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress    INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  started_at  TIMESTAMPTZ,
  duration    INTEGER,            -- wall-clock seconds
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Allow anonymous reads so the UI works with the anon key.
-- Tighten these policies when you add auth.
ALTER TABLE runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_curve ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON runs         FOR SELECT USING (true);
CREATE POLICY "public read" ON run_metrics  FOR SELECT USING (true);
CREATE POLICY "public read" ON equity_curve FOR SELECT USING (true);
CREATE POLICY "public read" ON jobs         FOR SELECT USING (true);
