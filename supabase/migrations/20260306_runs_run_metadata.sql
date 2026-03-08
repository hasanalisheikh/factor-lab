-- =============================================================================
-- Persist execution metadata on runs (actual model impl + evidence digests)
-- =============================================================================

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS run_metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

