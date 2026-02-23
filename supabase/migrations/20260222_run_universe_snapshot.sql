-- Phase 10: Run-level universe snapshot to prevent execution drift
-- Idempotent migration.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS universe TEXT;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS universe_symbols TEXT[];

ALTER TABLE runs
  ALTER COLUMN universe SET DEFAULT 'ETF8';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'runs'
      AND column_name = 'run_params'
  ) THEN
    EXECUTE $sql$
      UPDATE runs
      SET universe = COALESCE(NULLIF(run_params->>'universe', ''), 'ETF8')
      WHERE universe IS NULL OR universe = ''
    $sql$;
  ELSE
    UPDATE runs
    SET universe = 'ETF8'
    WHERE universe IS NULL OR universe = '';
  END IF;
END $$;

ALTER TABLE runs
  ALTER COLUMN universe SET NOT NULL;
