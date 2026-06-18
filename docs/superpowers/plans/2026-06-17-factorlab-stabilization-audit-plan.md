# FactorLab Stabilization and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn FactorLab from a working but messy codebase into a documented, fast, auditable,
secure, and maintainable research platform.

**Architecture:** Execute this as a phased stabilization program: first add repo governance and
documentation truth, then characterize current behavior with tests and measurements, then refactor
the largest files behind unchanged interfaces, then address web/worker performance, migrations,
security, and final verification. Each phase must leave the app runnable and the validation suite
green.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Vitest, ESLint, Prettier, Python,
pandas, scikit-learn, LightGBM, Ruff, Supabase CLI.

---

## Scope Check

The user request covers multiple independent subsystems:

- Repository structure and generated-file hygiene
- Cross-agent instructions and maintainability memory
- Large-file refactors across TypeScript and Python
- Dashboard/data/runs performance
- Run creation and Python worker latency
- Environment safety and migration execution
- Full codebase debugging, security, and documentation audit
- Strict scalability audit for future additions, including large-file recurrence, broad shared
  helpers, unbounded queries, missing indexes, strategy extensibility, and worker growth paths

Do not attempt all of this as one unreviewed mega-change. Execute this plan in phases. If a phase
uncovers product behavior that conflicts with the PRD, stop and update `docs/prd.md` plus the
relevant implementation plan before changing behavior.

## Current Findings From Initial Inspection

- `AGENTS.md` exists locally but is untracked. `CLAUDE.md` is tracked and currently duplicates most
  agent instructions instead of delegating to `AGENTS.md`.
- The PRD source exists outside the repo at `/Users/hasansheikh/Downloads/Factor Lab.md`.
- `.env.local` exists and includes:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_REPORTS_BUCKET`
  - `WORKER_TRIGGER_URL`
  - `WORKER_TRIGGER_SECRET`
- `.env.local` does not include several documented operational keys from `.env.example`, including
  `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, Upstash keys, `ENABLE_DAILY_UPDATES`, and worker/ML tuning
  defaults.
- Supabase CLI is installed at `/opt/homebrew/bin/supabase`, but `supabase status` failed because
  Docker is not running.
- `services/engine/factorlab_engine.egg-info/` is tracked generated packaging output.
- Current largest source files exceed the requested hard limit:
  - `lib/supabase/queries.ts` at 2852 lines
  - `services/engine/factorlab_engine/supabase_io.py` at 2158 lines
  - `services/engine/factorlab_engine/worker.py` at 2102 lines
  - `app/actions/runs.ts` at 1694 lines
  - `lib/coverage-check.ts` at 1386 lines
  - `components/auth/login-form.tsx` at 1200 lines
  - `components/run-form.tsx` at 1173 lines

## File Structure Map

- Modify `AGENTS.md`: canonical instructions for all coding agents, including file-length policy,
  validation commands, docs-update policy, env safety, and migration rules.
- Modify `CLAUDE.md`: replace duplicated instructions with a short pointer to `AGENTS.md`.
- Create `docs/prd.md`: repo-owned PRD copied from `/Users/hasansheikh/Downloads/Factor Lab.md`,
  then reconciled with the live implementation.
- Create `docs/codebase-audit.md`: running audit of large files, structure decisions, performance
  findings, scalability findings, security findings, and resolved items.
- Create `scripts/check-file-length.mjs`: CI/local guard that fails when source files exceed 500
  lines and warns when they exceed 400 lines.
- Modify `package.json`: add `check:file-length` and include it in the full validation path.
- Modify `.gitignore`: ignore generated Python packaging and Supabase local temp state.
- Refactor `lib/supabase/queries.ts` into `lib/supabase/queries/*.ts` modules.
- Refactor `app/actions/runs.ts` into `app/actions/runs/*.ts` action helpers with the public action
  API preserved.
- Refactor `components/run-form.tsx` into smaller form sections under `components/run-form/`.
- Refactor `components/auth/login-form.tsx` into smaller auth form sections under
  `components/auth/login-form/`.
- Refactor `lib/coverage-check.ts` into `lib/coverage-check/*.ts` modules.
- Refactor `services/engine/factorlab_engine/worker.py` into worker orchestration, claiming,
  execution, ingest repair, and HTTP trigger modules.
- Refactor `services/engine/factorlab_engine/supabase_io.py` into typed repository modules for
  runs, jobs, prices, reports, and ingest jobs.
- Update `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/user-guide.md`,
  `docs/strategies.md`, and `services/engine/README.md` after behavior changes.

### Task 1: Canonical Agent Instructions and PRD Import

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `docs/prd.md`
- Create: `docs/codebase-audit.md`

- [ ] **Step 1: Write the canonical `AGENTS.md` content**

Replace `AGENTS.md` with this source-of-truth structure, preserving the existing formatting table
and adding the missing governance rules:

````markdown
# FactorLab — Contributor & Agent Instructions

## Source of truth

All coding agents must read this file before changing the repository. Tool-specific files such as
`CLAUDE.md` must point here instead of duplicating policy.

## Maintainability rules

- Target 100-400 lines per source file.
- 500 lines is a hard maximum for hand-written source files.
- Split files by responsibility before adding behavior to an oversized file.
- Generated files, dependency folders, build outputs, and lockfiles are excluded from the
  line-count rule.
- Update relevant docs whenever product behavior, setup, schema, env, or operations change.

## Formatting rules

This repo enforces a single formatting standard. **Always follow it; never invent one-off style.**

| Language               | Formatter   | Indent | Quotes | Semi | Trailing comma | Print width |
| ---------------------- | ----------- | ------ | ------ | ---- | -------------- | ----------- |
| TS / TSX / JS / MJS    | Prettier    | 2 sp   | double | yes  | es5            | 100         |
| JSON / YAML / CSS / MD | Prettier    | 2 sp   | —      | —    | —              | 100         |
| Python                 | Ruff format | 4 sp   | double | —    | —              | 100         |
| SQL                    | manual      | 2 sp   | —      | —    | —              | —           |

Line endings: **LF** everywhere. UTF-8. Final newline at end of file.

Config files: `.prettierrc`, `.editorconfig`, `services/engine/pyproject.toml [tool.ruff.format]`.

## Import ordering (TypeScript/JS)

Group imports in this order, separated by a blank line:

1. React / Next.js framework imports
2. Third-party packages (`lucide-react`, `recharts`, `zod`, etc.)
3. Internal app imports (`@/components/…`, `@/lib/…`, `@/app/…`)
4. Type-only imports (`import type { … }`)

Do **not** use an import sorter plugin — maintain this order manually.

## After every edit

```bash
npm run format
npm run lint
npm run typecheck
```
````

For Python changes:

```bash
cd services/engine && ruff format . && ruff check .
```

Full validation suite:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run check:file-length
```

## Environment and migration safety

- Never print secret values from `.env`, `.env.local`, Supabase, Vercel, or shell history.
- Check only whether required env keys are present unless the user explicitly asks otherwise.
- Do not commit `.env.local`, Supabase `.temp`, Python virtualenvs, or generated package metadata.
- Before applying migrations to a remote Supabase project, confirm the target project and capture
  the migration list.
- SQL migrations in `supabase/migrations/` are manually styled with 2-space indentation, uppercase
  SQL keywords, and snake_case columns.

## Do not touch

- `node_modules/`
- `.next/`
- `.venv/`
- `services/engine/.venv/`
- `playwright-audit/`
- lockfiles unless the user explicitly approves dependency changes

````

- [ ] **Step 2: Replace `CLAUDE.md` with a pointer**

```markdown
# FactorLab Claude Instructions

Claude and all automated coding agents must follow the repository-wide instructions in
[`AGENTS.md`](AGENTS.md).
````

- [ ] **Step 3: Import the PRD**

Run:

```bash
cp "/Users/hasansheikh/Downloads/Factor Lab.md" docs/prd.md
```

Expected: `docs/prd.md` exists and contains `FactorLab — Product Requirements Document (PRD)`.

- [ ] **Step 4: Create the audit ledger**

Create `docs/codebase-audit.md`:

```markdown
# FactorLab Codebase Audit

## Status

This document tracks structural, performance, migration, environment, and security audit work.

## Initial structural findings

| Area            | Finding                                                                     | Status  |
| --------------- | --------------------------------------------------------------------------- | ------- |
| Agent policy    | `CLAUDE.md` duplicated shared policy while `AGENTS.md` was untracked.       | Planned |
| PRD             | PRD lived outside the repo at `/Users/hasansheikh/Downloads/Factor Lab.md`. | Planned |
| Generated files | `services/engine/factorlab_engine.egg-info/` is tracked generated output.   | Planned |
| File size       | Multiple source files exceed the 500-line hard limit.                       | Planned |
| Env             | `.env.local` exists but lacks several documented operational defaults.      | Planned |
| Supabase        | CLI exists, but local status failed because Docker was unavailable.         | Planned |

## Performance findings

Measurements must be added before optimization changes.

## Security findings

Security review must cover RLS, service-role boundaries, cron authorization, guest isolation,
report ownership checks, rate limits, and env exposure.
```

- [ ] **Step 5: Format and validate the docs-only change**

Run:

```bash
npm run format -- docs/prd.md docs/codebase-audit.md AGENTS.md CLAUDE.md
npm run lint
npm run typecheck
```

Expected: formatting succeeds; lint and typecheck pass with 0 warnings/errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add AGENTS.md CLAUDE.md docs/prd.md docs/codebase-audit.md
git commit -m "docs: establish agent policy and PRD source"
```

Expected: commit succeeds without staging unrelated local files.

### Task 2: File-Length Guard and Generated-File Hygiene

**Files:**

- Create: `scripts/check-file-length.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Remove from git index only: `services/engine/factorlab_engine.egg-info/*`

- [ ] **Step 1: Add the line-count guard**

Create `scripts/check-file-length.mjs`:

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HARD_LIMIT = 500;
const TARGET_LIMIT = 400;
const INCLUDED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".py", ".css", ".md"]);
const EXCLUDED_PARTS = new Set([
  ".git",
  ".next",
  ".venv",
  ".vercel",
  "node_modules",
  "package-lock.json",
  "playwright-audit",
  "services/engine/.venv",
  "services/engine/factorlab_engine.egg-info",
  "supabase/migrations",
  "supabase/.temp",
]);

function isExcluded(path) {
  return [...EXCLUDED_PARTS].some((part) => path === part || path.includes(`/${part}/`));
}

function hasIncludedExtension(path) {
  return [...INCLUDED_EXTENSIONS].some((extension) => path.endsWith(extension));
}

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((path) => hasIncludedExtension(path) && !isExcluded(path));

const oversized = [];
const warnings = [];

for (const file of files) {
  const lineCount = readFileSync(file, "utf8").split("\n").length;
  if (lineCount > HARD_LIMIT) {
    oversized.push({ file, lineCount });
  } else if (lineCount > TARGET_LIMIT) {
    warnings.push({ file, lineCount });
  }
}

for (const warning of warnings) {
  console.warn(`[file-length] target exceeded: ${warning.file} (${warning.lineCount} lines)`);
}

if (oversized.length > 0) {
  for (const item of oversized) {
    console.error(`[file-length] hard limit exceeded: ${item.file} (${item.lineCount} lines)`);
  }
  process.exit(1);
}
```

- [ ] **Step 2: Add the npm script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "check:file-length": "node scripts/check-file-length.mjs"
  }
}
```

Preserve all existing scripts and only add the new key.

- [ ] **Step 3: Ignore generated local artifacts**

Append to `.gitignore`:

```gitignore

# Local runtime/tooling state
.ruff_cache/
.tmp/
.tmp-engine-venv/
.venv/
supabase/.temp/
services/engine/factorlab_engine.egg-info/
```

- [ ] **Step 4: Remove tracked generated package metadata from the index**

Run:

```bash
git rm -r --cached services/engine/factorlab_engine.egg-info
```

Expected: files are removed from git tracking but remain ignored if regenerated locally.

- [ ] **Step 5: Run the guard to capture current failures**

Run:

```bash
npm run check:file-length
```

Expected: FAIL listing current oversized files. This failure is acceptable for this task and becomes
the refactor backlog.

- [ ] **Step 6: Format, lint, typecheck, and commit**

Run:

```bash
npm run format -- scripts/check-file-length.mjs package.json .gitignore
npm run lint
npm run typecheck
git add scripts/check-file-length.mjs package.json .gitignore services/engine/factorlab_engine.egg-info
git commit -m "chore: add source file length guard"
```

Expected: lint/typecheck pass; commit succeeds. Do not require `check:file-length` to pass until
Tasks 3-7 complete.

### Task 3: Characterize and Split Oversized TypeScript Modules

**Files:**

- Modify: `lib/supabase/queries.ts`
- Create: `lib/supabase/queries/*.ts`
- Modify: `app/actions/runs.ts`
- Create: `app/actions/runs/*.ts`
- Modify tests under `lib/supabase/*.test.ts` and `app/actions/runs.test.ts`

- [ ] **Step 1: Capture the public exports**

Run:

```bash
rg "^export " lib/supabase/queries.ts app/actions/runs.ts
```

Expected: a list of public functions/types that must remain import-compatible.

- [ ] **Step 2: Run characterization tests**

Run:

```bash
npm run test:run -- lib/supabase/queries.test.ts lib/supabase/queries.compare.test.ts app/actions/runs.test.ts
```

Expected: PASS before refactoring. If a test fails before edits, document it in
`docs/codebase-audit.md` and fix the failing behavior before splitting.

- [ ] **Step 3: Split `lib/supabase/queries.ts` by responsibility**

Create these modules and move existing code without changing behavior:

```text
lib/supabase/queries/auth.ts
lib/supabase/queries/data-health.ts
lib/supabase/queries/jobs.ts
lib/supabase/queries/reports.ts
lib/supabase/queries/runs.ts
lib/supabase/queries/settings.ts
lib/supabase/queries/shared.ts
lib/supabase/queries/index.ts
```

Keep `lib/supabase/queries.ts` as a compatibility barrel:

```ts
export * from "./queries/index";
```

- [ ] **Step 4: Validate after the query split**

Run:

```bash
npm run test:run -- lib/supabase/queries.test.ts lib/supabase/queries.compare.test.ts
npm run lint
npm run typecheck
```

Expected: PASS with 0 warnings.

- [ ] **Step 5: Split `app/actions/runs.ts` by responsibility**

Create these modules and move existing code without changing behavior:

```text
app/actions/runs/create-run.ts
app/actions/runs/delete-run.ts
app/actions/runs/preflight.ts
app/actions/runs/resume-waiting-runs.ts
app/actions/runs/schema.ts
app/actions/runs/shared.ts
app/actions/runs/types.ts
```

Keep `app/actions/runs.ts` as a compatibility barrel:

```ts
export * from "./runs/create-run";
export * from "./runs/delete-run";
export * from "./runs/resume-waiting-runs";
export type * from "./runs/types";
```

- [ ] **Step 6: Validate after the actions split**

Run:

```bash
npm run test:run -- app/actions/runs.test.ts
npm run lint
npm run typecheck
```

Expected: PASS with 0 warnings.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/supabase app/actions app/actions/runs.test.ts lib/supabase/*.test.ts
git commit -m "refactor: split oversized run and query modules"
```

### Task 4: Characterize and Split Oversized UI Components

**Files:**

- Modify: `components/run-form.tsx`
- Create: `components/run-form/*.tsx`
- Modify: `components/auth/login-form.tsx`
- Create: `components/auth/login-form/*.tsx`
- Modify tests under `components/run-form.test.tsx` and `components/auth/login-form.test.tsx`

- [ ] **Step 1: Run current UI tests**

Run:

```bash
npm run test:run -- components/run-form.test.tsx components/auth/login-form.test.tsx
```

Expected: PASS before refactoring.

- [ ] **Step 2: Split `components/run-form.tsx`**

Create these modules:

```text
components/run-form/constants.ts
components/run-form/date-range-fields.tsx
components/run-form/form-errors.tsx
components/run-form/run-form-fields.tsx
components/run-form/run-form-schema.ts
components/run-form/run-form-submit.tsx
components/run-form/use-run-form-defaults.ts
```

Keep `components/run-form.tsx` as the public component wrapper.

- [ ] **Step 3: Split `components/auth/login-form.tsx`**

Create these modules:

```text
components/auth/login-form/auth-tabs.tsx
components/auth/login-form/create-account-form.tsx
components/auth/login-form/guest-button.tsx
components/auth/login-form/login-form-shell.tsx
components/auth/login-form/password-reset-link.tsx
components/auth/login-form/sign-in-form.tsx
components/auth/login-form/types.ts
```

Keep `components/auth/login-form.tsx` as the public component wrapper.

- [ ] **Step 4: Validate**

Run:

```bash
npm run test:run -- components/run-form.test.tsx components/auth/login-form.test.tsx
npm run lint
npm run typecheck
```

Expected: PASS with 0 warnings.

- [ ] **Step 5: Commit**

Run:

```bash
git add components/run-form.tsx components/run-form components/auth/login-form.tsx components/auth/login-form components/*.test.tsx components/auth/*.test.tsx
git commit -m "refactor: split oversized form components"
```

### Task 5: Split Oversized Python Engine Modules

**Files:**

- Modify: `services/engine/factorlab_engine/worker.py`
- Create: `services/engine/factorlab_engine/worker/*.py`
- Modify: `services/engine/factorlab_engine/supabase_io.py`
- Create: `services/engine/factorlab_engine/repositories/*.py`
- Modify tests under `services/engine/tests/`

- [ ] **Step 1: Run current engine tests**

Run:

```bash
cd services/engine && pytest
```

Expected: PASS before refactoring.

- [ ] **Step 2: Split worker orchestration**

Create these modules and preserve `factorlab-engine-worker = "factorlab_engine.worker:main"`:

```text
services/engine/factorlab_engine/worker/claiming.py
services/engine/factorlab_engine/worker/execution.py
services/engine/factorlab_engine/worker/http_server.py
services/engine/factorlab_engine/worker/ingest_repair.py
services/engine/factorlab_engine/worker/progress.py
services/engine/factorlab_engine/worker/settings.py
```

Keep `services/engine/factorlab_engine/worker.py` as a thin entrypoint that imports and calls the
new orchestrator.

- [ ] **Step 3: Split Supabase IO**

Create these repository modules:

```text
services/engine/factorlab_engine/repositories/client.py
services/engine/factorlab_engine/repositories/equity.py
services/engine/factorlab_engine/repositories/ingest_jobs.py
services/engine/factorlab_engine/repositories/jobs.py
services/engine/factorlab_engine/repositories/prices.py
services/engine/factorlab_engine/repositories/reports.py
services/engine/factorlab_engine/repositories/runs.py
```

Keep `services/engine/factorlab_engine/supabase_io.py` as a compatibility facade until all imports
are migrated.

- [ ] **Step 4: Validate engine**

Run:

```bash
cd services/engine && ruff format . && ruff check . && pytest
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add services/engine/factorlab_engine services/engine/tests
git commit -m "refactor: split oversized engine modules"
```

### Task 6: Performance Baseline and Optimization

**Files:**

- Modify: `docs/codebase-audit.md`
- Modify: dashboard, runs, data, compare, and worker files based on measured findings
- Add targeted tests next to changed modules

- [ ] **Step 1: Measure web route performance**

Run the app with worker disabled:

```bash
SKIP_FACTORLAB_WORKER=1 npm run dev:web
```

Measure first load and navigation for:

```text
/dashboard
/runs
/runs/new
/data
/compare
/settings
```

Record timings and query counts in `docs/codebase-audit.md`.

- [ ] **Step 2: Measure run creation latency**

Run:

```bash
node scripts/smoke-test.mjs
```

Expected: either PASS with timings or a documented env/worker failure in `docs/codebase-audit.md`.

- [ ] **Step 3: Fix N+1 and overfetching**

For each slow route, prefer one server query that returns the data the page needs. Add or update a
test that proves the query function is called once with the authenticated user id and bounded
limits.

- [ ] **Step 4: Add or verify database indexes**

Inspect migrations for indexes on:

```sql
runs(user_id, created_at DESC)
jobs(run_id)
jobs(status, updated_at)
equity_curve(run_id, date)
positions(run_id, rebalance_date)
reports(run_id)
prices(symbol, date)
data_ingest_jobs(status, updated_at)
```

Create a migration only for missing indexes. Use `CREATE INDEX IF NOT EXISTS`.

- [ ] **Step 5: Validate performance fixes**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
```

Expected: PASS. Manual route checks must show materially improved loads or a documented blocker.

- [ ] **Step 6: Commit**

Run:

```bash
git add app components lib supabase/migrations docs/codebase-audit.md
git commit -m "perf: optimize dashboard and run workflows"
```

### Task 7: Environment and Migration Safety

**Files:**

- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Modify: `docs/codebase-audit.md`
- Modify or create migrations only when schema/index gaps are proven

- [ ] **Step 1: Align `.env.example` with actual code usage**

Add missing keys that are currently referenced by code:

```dotenv
SHOW_INTERNAL_DATA_DIAGNOSTICS=false
SHOW_BACKTEST_WINDOW_AUDIT=false
SUPABASE_FETCH_TIMEOUT_MS=15000
SUPABASE_TRANSIENT_RETRY_ATTEMPTS=3
SUPABASE_TRANSIENT_RETRY_BASE_SECONDS=0.5
FACTORLAB_UNIVERSE=
FACTORLAB_BENCHMARK=SPY
ML_TOP_N=5
ML_COST_BPS=10
JOB_TIMEOUT_SECONDS_ML_RIDGE=900
JOB_TIMEOUT_SECONDS_ML_LIGHTGBM=1800
```

- [ ] **Step 2: Document local env presence without leaking values**

Run:

```bash
node -e "const fs=require('fs'); for (const f of ['.env.local','.env.example']) { if (!fs.existsSync(f)) continue; const keys=fs.readFileSync(f,'utf8').split(/\\r?\\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>l.split('=')[0]); console.log(f); for (const k of keys) console.log('  '+k); }"
```

Expected: key names only; no secret values.

- [ ] **Step 3: Confirm migration target before applying remote changes**

Run:

```bash
supabase projects list
supabase migration list --linked
```

Expected: target project and pending migrations are visible. If auth is missing, ask the user to
authenticate Supabase CLI before continuing.

- [ ] **Step 4: Apply migrations only after target confirmation**

Run:

```bash
supabase db push
```

Expected: migrations apply successfully or report no changes. Record the migration result in
`docs/codebase-audit.md`.

- [ ] **Step 5: Commit**

Run:

```bash
git add .env.example docs/deployment.md docs/codebase-audit.md supabase/migrations
git commit -m "chore: align env and migration documentation"
```

### Task 8: Security Audit

**Files:**

- Modify: `docs/codebase-audit.md`
- Modify tests under `lib/supabase`, `app/actions`, `app/api`, and `services/engine/tests`
- Modify implementation files only where findings are proven

- [ ] **Step 1: Audit service-role usage**

Run:

```bash
rg "SUPABASE_SERVICE_ROLE_KEY|createAdminClient|service_role|service-role" app components lib services scripts
```

Expected: all service-role usage is server-only, worker-only, script-only, or documented.

- [ ] **Step 2: Audit RLS and ownership checks**

Run:

```bash
rg "policy|ENABLE ROW LEVEL SECURITY|auth.uid|user_id" supabase/schema.sql supabase/migrations lib/supabase app/actions app/api
```

Expected: user-owned tables have RLS and ownership filters. Add tests for any missing checks.

- [ ] **Step 3: Audit protected routes and cron authorization**

Run:

```bash
npm run test:run -- app/api/cron/_lib/refresh.test.ts app/auth/callback/route.test.ts app/actions/auth.test.ts app/actions/reports.test.ts lib/supabase/isolation-rls.test.ts
```

Expected: PASS. Add regression tests before any authorization fixes.

- [ ] **Step 4: Document findings**

Update `docs/codebase-audit.md` with this table:

```markdown
## Security findings

| Finding | Evidence | Fix | Status |
| ------- | -------- | --- | ------ |
```

Only mark an item resolved after tests prove it.

- [ ] **Step 5: Commit**

Run:

```bash
git add app lib services supabase docs/codebase-audit.md
git commit -m "security: audit access boundaries"
```

### Task 9: README and Documentation Reconciliation

**Files:**

- Modify: `README.md`
- Modify: `docs/prd.md`
- Modify: `docs/architecture.md`
- Modify: `docs/deployment.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/strategies.md`
- Modify: `services/engine/README.md`

- [ ] **Step 1: Compare PRD to actual behavior**

For each PRD acceptance criterion, record one of:

```text
Implemented
Partially implemented
Not implemented
Out of date
```

Write the result in `docs/prd.md` under a new `Implementation Status` section.

- [ ] **Step 2: Update README with current repo truth**

Keep the existing README product framing, but ensure it links to `docs/prd.md`,
`docs/codebase-audit.md`, and the current validation commands.

- [ ] **Step 3: Update operational docs**

Ensure `docs/deployment.md` describes:

```text
required env keys
optional env keys
safe migration workflow
worker trigger model
local Docker requirement for Supabase local status
```

- [ ] **Step 4: Validate docs**

Run:

```bash
npm run format -- README.md docs/prd.md docs/architecture.md docs/deployment.md docs/user-guide.md docs/strategies.md services/engine/README.md
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md docs services/engine/README.md
git commit -m "docs: reconcile README PRD and operations guide"
```

### Task 10: Final Comprehensive Verification

**Files:**

- Modify: `docs/codebase-audit.md`

- [ ] **Step 1: Run full web validation**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run check:file-length
```

Expected: all commands pass.

- [ ] **Step 2: Run full engine validation**

Run:

```bash
cd services/engine && ruff format . && ruff check . && pytest
```

Expected: all commands pass.

- [ ] **Step 3: Run smoke test**

Run:

```bash
node scripts/smoke-test.mjs
```

Expected: a run can be created, queued, processed by the configured worker path, and observed to
completion. If the worker or Supabase env is unavailable, record the exact missing prerequisite.

- [ ] **Step 4: Start local app for manual verification**

Run:

```bash
SKIP_FACTORLAB_WORKER=1 npm run dev:web
```

Verify:

```text
/login
/dashboard
/runs
/runs/new
/data
/compare
/settings
```

Expected: no runtime errors, no 10-second route loads, no broken layout, no unauthorized data
exposure.

- [ ] **Step 5: Run strict scalability audit**

Run:

```bash
npm run check:file-length
rg "select\\(\\\"\\*\\\"|select\\('\\*'|limit\\(1000|limit\\(500|TODO|FIXME" app components lib services scripts
rg "strategy_id|equal_weight|momentum_12_1|low_vol|trend_filter|ml_ridge|ml_lightgbm" app components lib services/engine/factorlab_engine
rg "created_at|updated_at|status|run_id|user_id" supabase/migrations supabase/schema.sql
```

Then inspect the results and update `docs/codebase-audit.md` with a `## Strict scalability audit`
section:

```markdown
## Strict scalability audit

| Check                      | Result    | Evidence                            | Follow-up                  |
| -------------------------- | --------- | ----------------------------------- | -------------------------- |
| File growth guard          | Pass/Fail | `npm run check:file-length` summary | None or exact file/task    |
| Shared helper sprawl       | Pass/Fail | `rg` findings reviewed              | None or exact module split |
| Query bounds and ownership | Pass/Fail | bounded/user-scoped query review    | None or exact query        |
| Index readiness            | Pass/Fail | migration/index review              | None or exact migration    |
| Strategy extensibility     | Pass/Fail | strategy registry/branch review     | None or exact refactor     |
| Worker extensibility       | Pass/Fail | worker/repository boundary review   | None or exact module       |
```

Expected: every row is `Pass` or has an explicit follow-up with file path, owner task, and reason.
Do not mark the stabilization complete while scalability findings are vague or untriaged.

- [ ] **Step 6: Record final audit result**

Update `docs/codebase-audit.md`:

```markdown
## Final verification

| Check            | Result    | Evidence               |
| ---------------- | --------- | ---------------------- |
| Formatting       | Pass/Fail | command output summary |
| Lint             | Pass/Fail | command output summary |
| Typecheck        | Pass/Fail | command output summary |
| Vitest           | Pass/Fail | command output summary |
| Python           | Pass/Fail | command output summary |
| File length      | Pass/Fail | command output summary |
| Smoke test       | Pass/Fail | command output summary |
| Manual app check | Pass/Fail | route summary          |
```

- [ ] **Step 7: Commit**

Run:

```bash
git add docs/codebase-audit.md
git commit -m "docs: record final stabilization audit"
```

## Self-Review

- Spec coverage: The plan covers agent instructions, PRD import, docs updates, file-length policy,
  oversized file refactors, performance, migrations, env safety, security, README updates, and full
  verification.
- Known gap: Exact implementation code for splitting the largest files must be produced during the
  relevant refactor tasks after characterization tests lock behavior. Moving thousands of existing
  lines blindly inside this plan would be less reliable than preserving public interfaces and using
  the tests as the executable spec.
- Type consistency: Compatibility barrels preserve current import paths while new modules are
  introduced.
- Risk: Applying Supabase migrations requires explicit target confirmation. Docker is currently not
  running, so local Supabase status cannot be inspected yet.
