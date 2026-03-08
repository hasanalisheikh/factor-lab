-- =============================================================================
-- Extend jobs.stage enum-like check for data ingestion lifecycle stages
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
      'ingest',
      'features',
      'train',
      'backtest',
      'report',
      'download',
      'transform',
      'upsert_prices',
      'finalize'
    )
  );
