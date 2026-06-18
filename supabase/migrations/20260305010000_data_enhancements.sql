-- =============================================================================
-- Data page enhancements: RPC aggregates + ingestion history log
-- Run AFTER schema.sql and prior migrations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. data_ingestion_log: lightweight per-run ingestion history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_ingestion_log (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT        NOT NULL DEFAULT 'success', -- success | partial | error
  tickers_updated  INTEGER     NOT NULL DEFAULT 0,
  rows_upserted    INTEGER     NOT NULL DEFAULT 0,
  note             TEXT,
  source           TEXT        NOT NULL DEFAULT 'yfinance'
);

ALTER TABLE data_ingestion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_ingestion_log_read" ON data_ingestion_log
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 2. get_data_health_agg(): single-query aggregate across prices
--    Returns: ticker_count, min_date, max_date, actual_rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_data_health_agg()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT json_build_object(
    'ticker_count', COUNT(DISTINCT ticker),
    'min_date',     MIN(date)::TEXT,
    'max_date',     MAX(date)::TEXT,
    'actual_rows',  COUNT(*)
  )
  FROM prices;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_ticker_day_counts(): per-ticker row counts, ascending (fewest first)
--    Used to identify most-missing tickers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ticker_day_counts()
RETURNS TABLE(ticker TEXT, actual_days BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT ticker, COUNT(*)::BIGINT AS actual_days
  FROM prices
  GROUP BY ticker
  ORDER BY actual_days ASC;
$$;

-- ---------------------------------------------------------------------------
-- 4. Supporting index: date-only range queries on prices
--    (ticker, date) unique index already exists; add date-only index for
--    pure date-range aggregation (e.g. benchmark coverage count).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices (date);
