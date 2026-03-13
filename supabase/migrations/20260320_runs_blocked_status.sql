-- Allow run-level blocked status for predictable terminal denials.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runs_status_check'
      AND conrelid = 'runs'::regclass
  ) THEN
    ALTER TABLE runs DROP CONSTRAINT runs_status_check;
  END IF;
END $$;

ALTER TABLE runs
  ADD CONSTRAINT runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'blocked', 'waiting_for_data'));
