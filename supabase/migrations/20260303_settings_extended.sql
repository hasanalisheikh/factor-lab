-- ─── Extend user_settings with backtest default columns ──────────────────────
-- Idempotent via ADD COLUMN IF NOT EXISTS.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS default_initial_capital  NUMERIC(15,2) NOT NULL DEFAULT 100000
    CHECK (default_initial_capital > 0),
  ADD COLUMN IF NOT EXISTS default_rebalance_frequency TEXT NOT NULL DEFAULT 'Monthly'
    CHECK (default_rebalance_frequency IN ('Monthly', 'Weekly')),
  ADD COLUMN IF NOT EXISTS default_date_range_years  INTEGER NOT NULL DEFAULT 5
    CHECK (default_date_range_years >= 1 AND default_date_range_years <= 30),
  ADD COLUMN IF NOT EXISTS apply_costs_default       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slippage_bps_default      INTEGER NOT NULL DEFAULT 0
    CHECK (slippage_bps_default >= 0 AND slippage_bps_default <= 500);
