-- Rename BRK.B → BRK-B across all tables.
-- yfinance (and most providers) use BRK-B as the canonical ticker;
-- dot notation causes permanent "blocked" ingest jobs.

-- Rename existing price rows (safe: UNIQUE constraint is (ticker, date))
UPDATE prices SET ticker = 'BRK-B' WHERE ticker = 'BRK.B';

-- Rename ticker_stats cache row
UPDATE ticker_stats SET symbol = 'BRK-B' WHERE symbol = 'BRK.B';

-- Rename any pending/running ingest jobs
UPDATE data_ingest_jobs SET symbol = 'BRK-B' WHERE symbol = 'BRK.B' AND status IN ('queued', 'running');

-- Remove permanently blocked jobs for the old symbol so auto-maintain re-queues BRK-B
DELETE FROM data_ingest_jobs WHERE symbol = 'BRK.B' AND status = 'blocked';

-- Remove any remaining failed/completed jobs for the old symbol (new ingest will use BRK-B)
DELETE FROM data_ingest_jobs WHERE symbol = 'BRK.B';
