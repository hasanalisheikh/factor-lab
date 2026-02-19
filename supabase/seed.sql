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
