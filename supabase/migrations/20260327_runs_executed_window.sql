-- Add executed window columns to runs.
-- executed_start_date / executed_end_date record the actual first/last dates present
-- in equity_curve after a backtest completes — distinct from the requested start_date / end_date.
-- NULL for non-completed runs, or pre-migration runs that have not been backfilled.

ALTER TABLE runs
  ADD COLUMN executed_start_date DATE,
  ADD COLUMN executed_end_date   DATE;

-- Backfill from equity_curve for all existing completed runs.
UPDATE runs r
SET
  executed_start_date = sub.min_date,
  executed_end_date   = sub.max_date
FROM (
  SELECT run_id,
         MIN(date)::DATE AS min_date,
         MAX(date)::DATE AS max_date
  FROM   equity_curve
  GROUP  BY run_id
) sub
WHERE r.id = sub.run_id
  AND r.status = 'completed';
