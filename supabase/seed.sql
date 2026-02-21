-- FactorLab Demo Seed Data
-- Run this AFTER schema.sql in the Supabase SQL Editor.
-- Uses fixed UUIDs so you can re-run safely (ON CONFLICT DO NOTHING).

-- ─── Runs ─────────────────────────────────────────────────────────────────────
INSERT INTO runs (id, name, strategy_id, status, start_date, end_date, created_at)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Momentum 12-1 Backtest',
    'momentum_12_1',
    'completed',
    '2023-01-02',
    '2024-01-01',
    NOW() - INTERVAL '3 days'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Equal Weight Baseline',
    'equal_weight',
    'completed',
    '2023-01-02',
    '2024-01-01',
    NOW() - INTERVAL '5 days'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'ML LightGBM Alpha v1',
    'ml_lightgbm',
    'completed',
    '2023-01-02',
    '2024-01-01',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Metrics ──────────────────────────────────────────────────────────────────
INSERT INTO run_metrics (run_id, cagr, sharpe, max_drawdown, turnover, volatility, win_rate, profit_factor, calmar)
VALUES
  ('11111111-1111-1111-1111-111111111111', 0.284, 1.82, -0.147, 0.42, 0.156, 0.623, 1.94, 1.93),
  ('22222222-2222-2222-2222-222222222222', 0.178, 1.24, -0.118, 0.18, 0.142, 0.548, 1.52, 1.51),
  ('33333333-3333-3333-3333-333333333333', 0.351, 2.14, -0.182, 0.67, 0.164, 0.671, 2.31, 1.93)
ON CONFLICT (run_id) DO NOTHING;

-- ─── Equity Curves ────────────────────────────────────────────────────────────
-- Weekly snapshots (53 points ≈ 1 year).
-- Uses deterministic math (sin-wave volatility) so the curves look realistic
-- without relying on random() which would differ on every run.

-- Run 1 — Momentum 12-1 (strong uptrend, moderate oscillation)
INSERT INTO equity_curve (run_id, date, portfolio, benchmark)
SELECT
  '11111111-1111-1111-1111-111111111111',
  ('2023-01-02'::date + (n * 7 || ' days')::interval)::date,
  ROUND((100000 * EXP(0.284 / 52.0 * n + 0.018 * SIN(n * 0.8)))::numeric, 2),
  ROUND((100000 * EXP(0.178 / 52.0 * n + 0.010 * SIN(n * 0.6)))::numeric, 2)
FROM generate_series(0, 52) n
ON CONFLICT (run_id, date) DO NOTHING;

-- Run 2 — Equal Weight Baseline (steady, closely tracks benchmark)
INSERT INTO equity_curve (run_id, date, portfolio, benchmark)
SELECT
  '22222222-2222-2222-2222-222222222222',
  ('2023-01-02'::date + (n * 7 || ' days')::interval)::date,
  ROUND((100000 * EXP(0.178 / 52.0 * n + 0.008 * SIN(n * 0.5)))::numeric, 2),
  ROUND((100000 * EXP(0.178 / 52.0 * n + 0.010 * SIN(n * 0.6)))::numeric, 2)
FROM generate_series(0, 52) n
ON CONFLICT (run_id, date) DO NOTHING;

-- Run 3 — ML LightGBM Alpha (highest returns, more volatile)
INSERT INTO equity_curve (run_id, date, portfolio, benchmark)
SELECT
  '33333333-3333-3333-3333-333333333333',
  ('2023-01-02'::date + (n * 7 || ' days')::interval)::date,
  ROUND((100000 * EXP(0.351 / 52.0 * n + 0.022 * SIN(n * 1.1)))::numeric, 2),
  ROUND((100000 * EXP(0.178 / 52.0 * n + 0.010 * SIN(n * 0.6)))::numeric, 2)
FROM generate_series(0, 52) n
ON CONFLICT (run_id, date) DO NOTHING;

-- ─── Jobs ─────────────────────────────────────────────────────────────────────
INSERT INTO jobs (name, status, progress, started_at, duration)
VALUES
  ('Data fetch: US Equities 2023',   'completed', 100, NOW() - INTERVAL '5 days 2 hours', 142),
  ('Factor computation: Momentum',   'completed', 100, NOW() - INTERVAL '3 days 1 hour',  87),
  ('Backtest: ML LightGBM Alpha v1', 'completed', 100, NOW() - INTERVAL '1 day 3 hours',  234),
  ('Report generation',              'queued',      0, NULL,                               NULL);

-- ─── ML Feature Store (sample rows) ──────────────────────────────────────────
INSERT INTO features_monthly (ticker, date, momentum, reversal, volatility, beta, drawdown)
VALUES
  ('SPY', '2023-10-31', 0.084, -0.021, 0.143, 1.000, -0.037),
  ('QQQ', '2023-10-31', 0.112, -0.035, 0.192, 1.240, -0.061),
  ('IWM', '2023-10-31', 0.051, -0.012, 0.181, 1.080, -0.074),
  ('SPY', '2023-11-30', 0.096,  0.014, 0.137, 1.000, -0.019),
  ('QQQ', '2023-11-30', 0.134,  0.018, 0.185, 1.210, -0.028),
  ('IWM', '2023-11-30', 0.067,  0.009, 0.174, 1.050, -0.041)
ON CONFLICT (ticker, date) DO NOTHING;

-- ─── ML Model Metadata ───────────────────────────────────────────────────────
INSERT INTO model_metadata (
  run_id,
  model_name,
  train_start,
  train_end,
  train_rows,
  prediction_rows,
  rebalance_count,
  top_n,
  cost_bps,
  feature_columns,
  feature_importance,
  model_params
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'ml_lightgbm',
  '2019-01-31',
  '2023-12-31',
  1980,
  240,
  24,
  10,
  10,
  ARRAY['momentum', 'reversal', 'volatility', 'beta', 'drawdown'],
  '{"momentum":0.34,"reversal":0.12,"volatility":0.18,"beta":0.09,"drawdown":0.27}'::jsonb,
  '{"n_estimators":300,"learning_rate":0.05,"num_leaves":31}'::jsonb
)
ON CONFLICT (run_id) DO NOTHING;

-- ─── ML Predictions (sample rows) ────────────────────────────────────────────
INSERT INTO model_predictions (
  run_id,
  model_name,
  as_of_date,
  target_date,
  ticker,
  predicted_return,
  realized_return,
  rank,
  selected,
  weight
)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-10-31', '2023-11-30', 'QQQ', 0.028, 0.021, 1, true, 0.333333),
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-10-31', '2023-11-30', 'SPY', 0.017, 0.013, 2, true, 0.333333),
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-10-31', '2023-11-30', 'IWM', 0.011, 0.006, 3, true, 0.333333),
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-11-30', '2023-12-29', 'QQQ', 0.022, 0.019, 1, true, 0.333333),
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-11-30', '2023-12-29', 'SPY', 0.014, 0.011, 2, true, 0.333333),
  ('33333333-3333-3333-3333-333333333333', 'ml_lightgbm', '2023-11-30', '2023-12-29', 'IWM', 0.009, 0.004, 3, true, 0.333333)
ON CONFLICT (run_id, model_name, as_of_date, ticker) DO NOTHING;
