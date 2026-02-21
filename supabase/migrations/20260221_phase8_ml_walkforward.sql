-- Phase 8 ML walk-forward migration (idempotent)
-- Adds monthly features + model metadata/predictions tables.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Monthly cross-sectional feature store
CREATE TABLE IF NOT EXISTS public.features_monthly (
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

-- Per-run model metadata (one row per run)
CREATE TABLE IF NOT EXISTS public.model_metadata (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id              UUID        NOT NULL REFERENCES public.runs (id) ON DELETE CASCADE,
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

-- Per-ticker monthly prediction outputs
CREATE TABLE IF NOT EXISTS public.model_predictions (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id            UUID        NOT NULL REFERENCES public.runs (id) ON DELETE CASCADE,
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

ALTER TABLE public.features_monthly  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_metadata    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_predictions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'features_monthly'
      AND policyname = 'public read'
  ) THEN
    CREATE POLICY "public read"
      ON public.features_monthly
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'model_metadata'
      AND policyname = 'public read'
  ) THEN
    CREATE POLICY "public read"
      ON public.model_metadata
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'model_predictions'
      AND policyname = 'public read'
  ) THEN
    CREATE POLICY "public read"
      ON public.model_predictions
      FOR SELECT
      USING (true);
  END IF;
END $$;
