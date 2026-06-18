-- Migration: add get_ticker_date_ranges RPC
-- Returns per-ticker first_date, last_date, actual_days from the prices table.
-- Used for inception-aware data health metrics and universe valid_from computation.

CREATE OR REPLACE FUNCTION get_ticker_date_ranges()
RETURNS TABLE(ticker TEXT, first_date TEXT, last_date TEXT, actual_days BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    ticker,
    MIN(date)::TEXT  AS first_date,
    MAX(date)::TEXT  AS last_date,
    COUNT(*)::BIGINT AS actual_days
  FROM prices
  GROUP BY ticker
  ORDER BY ticker;
$$;
