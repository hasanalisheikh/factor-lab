-- Task 6 route/workflow performance indexes.
-- Existing migrations already cover:
--   runs(user_id, created_at DESC)
--   equity_curve(run_id, date) via UNIQUE(run_id, date)
--   positions(run_id, date) via PRIMARY KEY(run_id, date, symbol)
--   reports(run_id) via UNIQUE(run_id)
--   prices(ticker, date) via UNIQUE(ticker, date) and idx_prices_ticker_date
--   jobs(run_id) via UNIQUE(run_id)

CREATE INDEX IF NOT EXISTS idx_jobs_status_updated_at
  ON public.jobs (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_data_ingest_jobs_status_updated_at
  ON public.data_ingest_jobs (status, updated_at);
