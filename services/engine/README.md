# FactorLab Engine

The engine is the Python compute layer for FactorLab. It processes queued backtests, handles price
ingestion, and supports maintenance workflows such as watchdog checks.

Use this README for engine-local commands. Use [../../docs/deployment.md](../../docs/deployment.md)
for repo-level deployment and environment guidance.

## Install

```bash
pip install -e ".[dev]"
```

## Core Commands

### Continuous worker

```bash
factorlab-engine-worker
```

Runs the always-on worker loop. In continuous mode it also exposes:

- `GET /health`
- `POST /trigger`

### One-shot worker

```bash
RUN_ONCE=1 python -m factorlab_engine.worker
```

Useful for GitHub Actions fallback processing and other single-pass executions.

### Price ingestion

```bash
factorlab-engine-ingest
factorlab-engine-ingest --start-date 2024-01-01
factorlab-engine-ingest --tickers "SPY,QQQ,IWM"
```

### Watchdog

```bash
python -m factorlab_engine.watchdog
```

## Required Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Common optional variables:

- `WORKER_TRIGGER_SECRET`
- `POLL_INTERVAL_SECONDS`
- `JOB_BATCH_SIZE`
- `RUN_ONCE`
- `FACTORLAB_FALLBACK_PROVIDER`
- `ML_MIN_TRAIN_DAYS`
- `ML_TRAIN_WINDOW_DAYS`
- `ML_REFIT_FREQ_DAYS`
- `ML_WARMUP_YEARS`

For the source-of-truth explanation of these settings, see
[../../docs/deployment.md](../../docs/deployment.md).
