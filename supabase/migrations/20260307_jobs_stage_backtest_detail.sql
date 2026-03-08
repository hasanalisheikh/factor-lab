-- =============================================================================
-- Add detailed backtest stage labels to jobs.stage check constraint
-- New stages: load_data, compute_signals, rebalance, metrics, persist
-- These give finer-grained progress visibility in the UI during a backtest run.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_stage_check'
      AND conrelid = 'jobs'::regclass
  ) THEN
    ALTER TABLE jobs DROP CONSTRAINT jobs_stage_check;
  END IF;
END $$;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_stage_check
  CHECK (
    stage IN (
      -- Backtest lifecycle (baseline strategies: equal_weight, momentum, low_vol, trend_filter)
      'ingest',
      'load_data',
      'compute_signals',
      'rebalance',
      'metrics',
      'persist',
      'report',
      -- ML-specific stages (ml_ridge, ml_lightgbm)
      'features',
      'train',
      'backtest',
      -- Data ingestion lifecycle
      'download',
      'transform',
      'upsert_prices',
      'finalize'
    )
  );
