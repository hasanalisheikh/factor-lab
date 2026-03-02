-- ─── Migration: extend strategy_id constraint to include low_vol + trend_filter
--
-- The schema.sql check was created before low_vol and trend_filter were added
-- to lib/types.ts and the Python worker. This migration drops the old constraint
-- and replaces it with one that covers all six supported strategy IDs.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE runs
  DROP CONSTRAINT IF EXISTS runs_strategy_id_check;

ALTER TABLE runs
  ADD CONSTRAINT runs_strategy_id_check
  CHECK (strategy_id IN (
    'equal_weight',
    'momentum_12_1',
    'ml_ridge',
    'ml_lightgbm',
    'low_vol',
    'trend_filter'
  ));
