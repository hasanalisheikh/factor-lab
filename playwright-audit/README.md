# FactorLab Playwright QA Audit Suite

Live browser-based QA harness that executes and audits every
**strategy × universe × benchmark** variation (162 total) in the running
FactorLab app and verifies correctness of every output.

---

## Prerequisites

- Node.js 18+
- A running FactorLab instance (default: `http://localhost:3000`)
- A valid user account (email + password), or guest access

---

## Setup

```bash
cd playwright-audit
npm install
npm run install-browsers   # installs Chromium
```

### Configure credentials

Create a `.env` file (not committed):

```bash
# playwright-audit/.env
BASE_URL=http://localhost:3000
AUDIT_EMAIL=your@email.com
AUDIT_PASSWORD=your-password
```

Or export them in your shell:

```bash
export BASE_URL=http://localhost:3000
export AUDIT_EMAIL=your@email.com
export AUDIT_PASSWORD=your-password
```

If `AUDIT_EMAIL`/`AUDIT_PASSWORD` are not set, the values in
`audit.config.ts` are used as defaults. Edit those to match your setup.

---

## Running the audit

### Full audit (all 162 combinations)

```bash
npx playwright test --project=audit
```

This runs serially: login → Data page snapshot → 162 run combinations → final reports.

**Estimated time:** Highly variable. Each completed run takes 1–30 minutes
(equal-weight: ~1–2 min; ML runs: up to 30 min). Budget 6–24 hours for the
full matrix. The suite is designed to be left running overnight.

### Resume a partial run

If the suite was interrupted, resume from where it left off:

```bash
RESUME=1 npx playwright test --project=audit
```

Results already in `artifacts/results/audit-results.json` are skipped.

### Filter to a subset

```bash
# Only one strategy
FILTER_STRATEGY=ml_ridge npx playwright test --project=audit

# Only one universe
FILTER_UNIVERSE=ETF8 npx playwright test --project=audit

# Only one benchmark
FILTER_BENCHMARK=SPY npx playwright test --project=audit

# Combine
FILTER_STRATEGY=equal_weight FILTER_UNIVERSE=ETF8 npx playwright test --project=audit
```

### Data page consistency tests only

```bash
npx playwright test tests/data-consistency.spec.ts --project=audit
```

---

## Outputs

All artifacts are written to `artifacts/`:

| Path | Description |
|------|-------------|
| `artifacts/results/audit-results.json` | Full machine-readable results (one object per run) |
| `artifacts/results/audit-results.csv` | Spreadsheet-friendly summary |
| `artifacts/results/audit-report.md` | Markdown report with results table + defects section |
| `artifacts/screenshots/` | Screenshots for failed runs (one per combination) |
| `artifacts/reports/` | Downloaded HTML tearsheets for each completed run |
| `playwright-report/` | Playwright HTML report (open with `npx playwright show-report`) |

### Generate reports manually (from existing results.json)

```bash
npm run report
```

---

## Verdict rules

| Verdict | Meaning |
|---------|---------|
| `PASS` | Run completed; UI and tearsheet outputs are consistent and correct |
| `VALID-BLOCK` | Preflight truthfully blocked this combination; fix is actionable |
| `FAIL` | Any of: contradictory block, wrong KPIs, mismatch between UI and tearsheet, stuck job, missing evidence, encoding issue |

---

## What the suite verifies

For every run combination:

1. **Identity consistency** — run name, strategy, universe, benchmark, dates match across runs list → detail page → tearsheet
2. **Preflight correctness** — blocks are truthful and actionable; no contradictions with Data page health
3. **KPI correctness** — CAGR, Sharpe, Max DD, Volatility, Win Rate, Profit Factor, Turnover, Calmar: sane ranges + UI/tearsheet match
4. **Chart date range** — equity curve covers the full effective run window
5. **Holdings** — weights sum to ~100%; top-N constraint respected
6. **Trades** — rebalance log is non-empty for completed runs
7. **ML Insights** — tab present for ML strategies; feature importance rendered; picks weight sum ~100%
8. **Tearsheet encoding** — no mojibake or raw Unicode corruption
9. **Data page consistency** — Data page health does not contradict preflight for the same benchmark/window

---

## Configuration reference

`audit.config.ts` contains all tunable parameters:

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | App URL (override with `$BASE_URL`) |
| `CREDENTIALS` | see config | Login email + password |
| `CANONICAL_START_DATE` | `2019-01-01` | Default start date for all runs |
| `CANONICAL_END_DATE` | `2025-12-31` | Default end date (snapped to cutoff) |
| `CANONICAL_COSTS_BPS` | `10` | Transaction costs |
| `CANONICAL_TOP_N` | ETF8:5, SP100:10, NASDAQ100:10 | Holdings count per universe |
| `RUN_COMPLETION_TIMEOUT_MS` | `1800000` (30 min) | Per-run timeout |
| `RUN_POLL_INTERVAL_MS` | `15000` | Status poll interval |

---

## Architecture

```
playwright-audit/
├── audit.config.ts          # Matrix definition + canonical defaults
├── playwright.config.ts     # Playwright project config
├── auth.setup.ts            # Login once, save session to .auth.json
├── pages/
│   ├── LoginPage.ts         # /login page interactions
│   ├── RunFormPage.ts       # /runs/new form filling + preflight handling
│   ├── RunDetailPage.ts     # /runs/:id tabs, KPI extraction, tearsheet download
│   └── DataPage.ts          # /data health reading
├── helpers/
│   ├── matrix.ts            # Generate 162-combination matrix
│   ├── sanity.ts            # KPI range checks + cross-metric consistency
│   ├── report-parser.ts     # Parse HTML tearsheet fields
│   ├── results.ts           # JSON / CSV / Markdown output writers
│   ├── verdict.ts           # PASS / VALID-BLOCK / FAIL classification
│   └── targeted.ts          # Targeted test factory, persistence, artifact capture
└── tests/
    ├── audit.spec.ts                  # Main 162-run audit (serial)
    ├── data-consistency.spec.ts       # Data page health checks
    ├── targeted-preflight.spec.ts     # T1–T8: Preflight boundary tests
    ├── targeted-ml.spec.ts            # T9–T16: ML edge case tests
    ├── targeted-charts.spec.ts        # T17–T22: Chart full-range tests
    ├── targeted-overlap.spec.ts       # T23–T25: Overlap/holdings truth tests
    └── targeted-reliability.spec.ts   # T26–T28: Reliability/stuck-state tests
```

---

## Targeted Edge-Case Tests (28 tests)

In addition to the 162-run matrix, a second test pack covers boundary, ML, chart,
overlap, and reliability edge cases that the matrix alone may miss.

### Run targeted tests only

```bash
npm run targeted                 # all 28 targeted tests
npm run targeted:preflight       # T1–T8:  Preflight boundary tests
npm run targeted:ml              # T9–T16: ML edge case tests
npm run targeted:charts          # T17–T22: Chart full-range tests
npm run targeted:overlap         # T23–T25: Benchmark overlap/holdings truth tests
npm run targeted:reliability     # T26–T28: Reliability/stuck-state tests
```

### Run full suite (matrix + targeted)

```bash
npm run full
```

### Targeted artifacts

| Path | Description |
|------|-------------|
| `artifacts/results/targeted-results.json` | Targeted test results |
| `artifacts/results/targeted-results.csv` | CSV export |
| `artifacts/results/targeted-report.md` | Markdown report with defects |

### Targeted test categories

| Category | Tests | What they verify |
|----------|-------|-----------------|
| Preflight Boundary | T1–T8 | Date clamping, healthy/unhealthy benchmark consistency, misleading UI actions |
| ML Edge | T9–T16 | Top-N limits, training window validation, ML Insights completeness, tearsheet encoding |
| Chart Full-Range | T17–T22 | Per-strategy chart end dates match effective run end dates |
| Overlap Truth | T23–T25 | Overlap warning appears iff benchmark is genuinely held in portfolio |
| Reliability | T26–T28 | waiting_for_data visibility, clean ingest resolution, stuck ingest feedback |

---

## Notes on run time

- `equal_weight`: fastest (~1–3 min per run)
- `momentum_12_1`, `low_vol`, `trend_filter`: medium (~2–5 min)
- `ml_ridge`, `ml_lightgbm`: slowest (~5–30 min depending on universe size and training window)

For a quick smoke test, run `FILTER_STRATEGY=equal_weight FILTER_UNIVERSE=ETF8` first
(9 runs, ~15–30 min total) to verify the suite is working before committing to the full matrix.

---

## Troubleshooting

**"Submit button disabled at time of submission"**
Universe data ingestion may be pending. The suite waits for the button to become enabled,
but if universe ingest is genuinely not complete, this is expected. Check the /data page.

**"No download/generate button found"**
The report may not have been generated. The suite clicks "Generate Report" if the
download link is absent. If neither appears, the run detail page may have an error.

**"Run timed out"**
Increase `RUN_COMPLETION_TIMEOUT_MS` in `audit.config.ts` or `$RUN_TIMEOUT_MS` env var.

**Playwright auth fails**
Verify `AUDIT_EMAIL` and `AUDIT_PASSWORD` are correct. The app may have rate limiting
on sign-in attempts — check the login page manually if the auth setup step fails.
