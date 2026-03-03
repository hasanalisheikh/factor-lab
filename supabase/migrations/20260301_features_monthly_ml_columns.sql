-- Add explicit ML feature columns used by walk-forward models.
-- Keep legacy columns (momentum/reversal/volatility/beta/drawdown) for compatibility.

ALTER TABLE public.features_monthly
  ADD COLUMN IF NOT EXISTS momentum_12_1 NUMERIC,
  ADD COLUMN IF NOT EXISTS momentum_6_1 NUMERIC,
  ADD COLUMN IF NOT EXISTS reversal_1m NUMERIC,
  ADD COLUMN IF NOT EXISTS vol_20d NUMERIC,
  ADD COLUMN IF NOT EXISTS vol_60d NUMERIC,
  ADD COLUMN IF NOT EXISTS beta_60d NUMERIC,
  ADD COLUMN IF NOT EXISTS drawdown_6m NUMERIC;
