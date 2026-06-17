# **FactorLab — Product Requirements Document (PRD)**

## **Product Overview**

### **What FactorLab is**

FactorLab is a **quant research dashboard** that lets users:

- **Create backtest runs** from a set of predefined strategies

- **Choose universe \+ benchmark \+ costs \+ Top N \+ date range**

- **Queue runs** to a background engine (Python worker), track job progress, and view results

- **Inspect outputs** (KPIs, equity curve, drawdown, holdings, trades, ML insights)

- **Compare runs** side-by-side

- **Generate & download a report** (HTML tearsheet) for any completed run

- **Monitor data quality** (coverage, missing ticker-days, benchmark health) and trigger data backfills when needed

### **Why it exists (the point)**

- Turn “random backtest scripts” into a **reproducible research workflow**

- Make it easy to answer: **“Does this strategy beat benchmark, under costs, over a real window, on a defined universe?”**

- Provide recruiter-grade signals: **systems design, data modeling, ML pipeline, job orchestration, RLS security, reporting UX**

---

## **Goals**

1. **One-click research loop**
   - Configure → queue → track progress → analyze → compare → export report.

2. **Reproducibility**
   - A run’s universe/benchmark/parameters and outputs are consistent and auditable.

3. **User isolation**
   - Every user (including guests) sees only their own runs and data.

4. **Correctness over flash**
   - Data coverage/benchmark overlap warnings exist so users don’t misinterpret results.

5. **Production-ready auth**
   - Full sign up / sign in / sign out (no demo-only mode), plus guest mode that still runs backtests.

6. **Performance**
   - Fast loads even as runs grow (indexes, fewer requests, query optimization).

---

## **Non-Goals (for MVP scope control)**

- Live trading, broker integration, order execution

- Strategy editor / custom strategy code upload

- Portfolio optimization beyond the defined strategies (no mean-variance optimizer yet)

- Paid billing/subscriptions (can be future)

---

## **Personas**

1. **Guest user**
   - Wants to try the app instantly and run backtests.

   - Must not clash with other guests; each guest gets an isolated account.

2. **Registered user**
   - Wants persistence, saved defaults, long-term research history.

3. **Recruiter / reviewer**
   - Will create an account, click around, run a sample backtest, download a report.

---

## **Step-By-Step Use Cases**

### **Use Case A — Guest runs a backtest in 60 seconds**

1. Visit `/login`

2. Click **Continue as Guest**

3. Land on Dashboard

4. Click **New Run**

5. Choose Strategy \+ Universe \+ Benchmark \+ Date Range

6. Click **Queue Backtest**

7. Watch job progress update live

8. Open run → view KPIs \+ equity curve \+ holdings/trades

9. Click **Generate Report** → download HTML

### **Use Case B — Registered user research workflow**

1. Create account (email \+ password)

2. Set defaults in **Settings → Backtest**

3. Create multiple runs across strategies

4. Compare runs in **Compare**

5. Use **Strategies** page to understand what each strategy means

6. Use **Data** page to verify benchmark/universe coverage

7. Export tearsheets for best runs

### **Use Case C — Avoid misleading results**

1. User chooses benchmark \= SPY

2. Strategy sometimes holds SPY

3. Run detail shows warning:
   - “This strategy holds SPY while using it as the benchmark… deltas may be less informative”

4. User interprets results appropriately

---

## **Key Features and Userflow**

### **1\) Authentication (Required)**

**Pages**

- `/login`:
  - Tabs: Sign In / Create Account

  - Button: Continue as Guest

- Middleware: protect all app routes; redirect unauthenticated → `/login`

**Guest mode requirements**

- Guest is a real Supabase Auth user created via admin API

- Guest runs are isolated (guest UUID email like `guest_<uuid>@factorlab.local`)

- Guest can create unlimited runs (no run limits)

- Guest can later “upgrade” to a real account (optional phase; at minimum, keep guest isolated)

**Account creation limits**

- No limits on runs/backtests.

- Rate limit only signup/guest creation (e.g., 10/hour/IP via Upstash).

- Optional: Cloudflare Turnstile CAPTCHA (recommended but not mandatory).

### **2\) Runs \+ Job Queue (Core)**

**Run creation inputs**

- Run name

- Strategy (select)

- Universe preset (select)

- Date range (bounded by available data coverage)

- Initial capital (sane range \+ default)

- Benchmark (select)

- Costs (bps)

- Top N (clamped to universe size; must never exceed available investable assets)

- Rebalance frequency:
  - Non-ML: monthly

  - ML: daily (explicitly shown)

**Run lifecycle**

- created → queued → running → completed OR failed

- UI must update without refresh (polling or realtime)

**Progress**

- Show phase progress: ingest → compute signals → rebalance loop → metrics → persist results

- Fix “stuck at X% until refresh”:
  - Use Supabase realtime or polling with backoff \+ `revalidatePath` where applicable

  - Ensure worker writes progress events consistently

### **3\) Results Views (Run Detail)**

Tabs:

- Overview

- Holdings

- Trades

- ML Insights (ML strategies only)

**Overview shows**

- KPI cards: CAGR, Sharpe, Max Drawdown, Turnover, Volatility, Win Rate, Profit Factor, Calmar

- Equity curve chart: Portfolio vs Benchmark

- Drawdown chart

- Assumptions card (universe, benchmark, costs, rebalance, Top N, window)

**Holdings**

- Latest rebalance holdings (ticker, weight)

- Optional: historical rebalance timeline

**Trades**

- Rebalance-by-rebalance turnover or implied trades list

**ML Insights**

- Feature importance

- Latest picks

- Model metadata (but wording should be “human-readable” with tooltips; see UI section)

### **4\) Multi-Benchmark Support (Required)**

- Run creation: benchmark select with at least:
  - SPY, QQQ, IWM, VTI, EFA, TLT, GLD, VNQ

- Store in `runs.benchmark` (text, default SPY)

- Every “vs SPY” label becomes “vs {benchmark}”

- Worker uses `runs.benchmark` to compute `benchmark_value` in equity curve

- Report uses selected benchmark everywhere

### **5\) Benchmark Overlap Warning (Required)**

Detect if the run’s portfolio holds the benchmark ticker.

- If positions table exists: check latest rebalance holdings:
  - if `symbol == runs.benchmark` and `weight > 0` → confirmed warning

- If positions not implemented: show only a “possible” warning if benchmark appears in universe and strategy type implies it may be held; otherwise hide.

Display:

- Run Detail and Dashboard KPI area banner:
  - “Note: This strategy holds {benchmark} while using it as the benchmark…”

- Tooltip “Why?” with same explanation

- Also add note to report: “Benchmark overlap: …”

### **6\) Dashboard (Core)**

- Top KPI summary for selected run

- Recent runs list

- Equity curve preview

- Global search bar in topbar: searches runs/jobs quickly

### **7\) Compare (Core)**

- Compare at least two completed runs

- Show:
  - KPI comparison

  - Equity curves overlay

  - Summary table

### **8\) Strategies & Guide (Required)**

Two informational sections:

1. **Strategies page**
   - Strategy glossary & methodology (what the strategies mean, how rebalancing works)

   - One card per strategy with:
     - What it does

     - Inputs (Top N, universe, rebalance)

     - When it tends to work/fail

     - Key risks

2. **How to Use guide**
   - Similar to Strategies page structure

   - Short workflow: create run → interpret KPIs → compare → export report

   - Include warnings section: benchmark overlap, data coverage, survivorship bias, costs model simplifications

### **9\) Data Health \+ Ingestion (Required)**

**Data page metrics**

- Tickers ingested

- Coverage window (start → end)

- Missing ticker-days

- Completeness %

- Last updated \+ freshness label (Fresh/Stale)

- Most missing tickers table

- Benchmark coverage panel (for default benchmark and optionally selected benchmark)

**Critical requirements**

- Data must support a minimum valid run window based on actual ingested prices

- Fix incorrect date formatting (use consistent ISO or user locale; choose one and stick to it)

- Fix “missing days” correctness:
  - Use trading-day calendar logic (Mon–Fri approximation is OK for MVP but must be labeled)

  - Clearly define “expected days” and “missing ticker-days”

**Backfill prevention**

- If benchmark ticker coverage is extremely low (e.g., QQQ missing \~2900 days), the system must detect “needs backfill” and offer a one-click fix:
  - “Backfill QQQ (2015-01-02 → today)”

- If a user selects a benchmark/universe for the first time and coverage \< threshold, auto-trigger backfill job (admin-side)

**Ingestion stuck**

- If ingestion job shows “running” too long:
  - Show last heartbeat / updated_at

  - Allow “Retry ingest” button

  - Ensure jobs update status on completion/failure reliably

### **10\) Reporting / Tearsheet (Required)**

- Generate HTML report for completed runs

- Upload to Supabase Storage bucket (e.g., `reports`)

- Persist `reports` row with url \+ storage_path \+ run_id

- Download link appears on run detail

**Report must include**

- Run metadata (strategy, universe, benchmark, window, costs, Top N, rebalance frequency)

- KPI grid

- Equity curve vs benchmark

- Drawdown

- Turnover/cost assumptions

- Limitations section (always present)

- Optional: benchmark overlap note

- Encoding must be correct (avoid `â€”` artifacts):
  - Ensure UTF-8 output and correct HTML escaping

### **11\) Settings (Required)**

Settings should have two tabs:

**Backtest Defaults**

- Default universe

- Default benchmark

- Default costs (bps)

- Default slippage (bps) (even if not modeled yet, store for future)

- Default Top N (clamped by universe size)

- Default initial capital (range-limited)

- Default date range shortcut (e.g., 1Y/3Y/5Y/Max)

- Toggle: apply transaction costs by default

**Account Settings**

- Profile summary (email, user type, user id copy)

- Change password (for real accounts)

- Upgrade guest → real account (optional but highly desirable)

- Sign out button

- (Future) Email preferences / notification preferences

### **12\) Notifications \+ Search \+ Profile buttons (Required)**

Topbar icons should do real things:

- Search icon:
  - Focus search input, route to `/runs?q=...` or a global search results page

- Notifications bell:
  - Dropdown panel showing recent job events (queued/running/completed/failed)

  - “View all jobs” link

  - Badge count for unread events (optional)

- Profile icon:
  - Dropdown: Settings, Sign out

  - Show current email or “Guest”

---

## **UI Design**

### **Visual direction**

- Dark, minimal, black/charcoal base with green accent (FactorLab brand)

- Consistent rounded cards, subtle borders, soft shadows

- Avoid “left-isolated” pages:
  - Use a consistent content container width and centering rules so Runs/Settings don’t feel stuck to the left on wide monitors

### **Layout rules**

- App shell:
  - Left sidebar fixed width

  - Main area flex-1 fills remaining width

  - Content container should either:
    - be fluid full-width with comfortable padding, OR

    - use a max-width with `mx-auto` so it’s centered (but never left-aligned max-width)

- Charts:
  - Equity curve should support **ALL** range by default (not capped at 1Y)

  - Time-range buttons: 1M / 3M / 6M / 1Y / ALL

  - Default selection should be **ALL** for runs longer than 1Y

### **Copy & terminology (reduce “too technical”)**

- Keep “advanced details” behind tooltips or “Details” accordion:
  - Example: “Positions digest”, “Equity digest”, “Model version”

- Prefer user-friendly labels:
  - “Training rows” → “Training examples”

  - “Feature set” → “Signals used”

  - Provide tooltip: “Why this matters”

---

## **Backend**

### **Tech stack**

- Frontend: Next.js (App Router), TypeScript

- Backend: Supabase (Postgres \+ Auth \+ Storage \+ RLS)

- Worker: Python engine (factorlab_engine) running backtests and ML walk-forward

- Deployment: Vercel (web) \+ worker deployment (separate process)

### **Core tables (conceptual)**

- `runs`
  - id, user_id, name, strategy_id, universe_preset, universe_symbols(snapshot), benchmark, start_date, end_date, initial_capital, top_n, costs_bps, rebalance_freq, status, created_at

- `jobs`
  - id, run_id, status, progress, phase, message, started_at, finished_at, updated_at

- `equity_curve`
  - run_id, date, portfolio_value, benchmark_value

- `run_metrics`
  - run_id, cagr, sharpe, max_drawdown, turnover, volatility, win_rate, profit_factor, calmar

- `positions` (recommended)
  - run_id, rebalance_date, symbol, weight

- `trades` (optional now; can be derived)

- `reports`
  - run_id unique, storage_path, url, created_at

- `user_settings`
  - user_id unique, default params

### **Worker responsibilities**

- Load run config from DB

- Resolve universe symbols:
  - Prefer `runs.universe_symbols` snapshot

  - Fallback to preset map if missing

- Ensure benchmark available; compute benchmark equity curve

- Execute strategy logic:
  - Non-ML: monthly rebalance

  - ML: daily walk-forward, refit freq, leakage-safe features, next-day target

- Persist:
  - positions, equity_curve, metrics, ML metadata

- Update job progress frequently and reliably

### **Data ingestion responsibilities**

- Maintain `prices` table (or equivalent)

- Support:
  - Bulk daily pulls for all tickers

  - On-demand backfill for a ticker \+ date range

- Surface ingestion activity in UI via jobs/events

---

## **Naming Patterns**

### **Files / folders**

- `app/(dashboard)/...` for protected routes

- `app/login/...` for auth UI

- `app/actions/...` for server actions (runs, reports, auth, settings)

- `components/...` for UI components

- `components/layout/...` for AppShell, Sidebar, Topbar

- `services/engine/...` for Python worker and strategy logic

- `lib/supabase/...` for typed client \+ queries \+ types

- `supabase/migrations/...` for DB migrations

### **Code conventions**

- Components: `kebab-case.tsx`

- Server actions: `verbNounAction` (e.g., `createRunAction`)

- Queries: `getXByY`

- Strategy IDs: stable strings (`equal_weight`, `momentum_12_1`, `ml_ridge`, etc.)

---

## **Constraints**

- Must run on Vercel for the web app

- Supabase is the single source of truth (RLS enforced)

- Guest mode must be real and isolated

- No run limits; only account creation rate limiting

- Must keep “research only / not financial advice” messaging visible in reports and key pages

---

## **Security**

- Supabase Auth required for all protected routes

- Middleware redirects unauthenticated → `/login`

- RLS:
  - All user-owned tables filtered by `user_id = auth.uid()`

  - Reports generation must verify run ownership

- Guest creation uses service role key server-side only

- Rate limit:
  - signup \+ guest creation endpoints

- Optional Turnstile for signup/guest creation

- Never expose service role key to client

---

## **Performance Requirements**

- Add indexes for any RLS-filtered columns (especially `runs.user_id`, `runs.user_id + created_at`)

- Avoid N+1 query patterns (batch queries, single request where possible)

- Equity curve queries should support full history efficiently

- Polling/realtime should not hammer DB:
  - Use sensible intervals \+ exponential backoff

---

## **Quality / Acceptance Criteria (high-level)**

1. Any user can sign up, sign in, sign out; guest can run backtests.

2. Users never see other users’ runs/jobs/reports (RLS proven).

3. “vs {benchmark}” is correct everywhere; no hardcoded SPY remains.

4. Equity curve “ALL” shows full run length (no 1Y cutoff).

5. Benchmark overlap warning triggers only when confirmed (or clearly marked “possible”).

6. Data Health correctly detects missing coverage and can backfill benchmarks.

7. Reports render with correct UTF-8 punctuation and readable wording.

8. ML strategies succeed on ETF8 with Top N clamping and sufficient training data diagnostics.

---

## **Phases of Development (recommended roadmap)**

1. Phase 0 — UI scaffolding \+ basic runs

2. Phase 1 — Supabase schema \+ RLS \+ core run pipeline

3. Phase 2 — Worker execution \+ metrics \+ equity curve

4. Phase 3 — Run detail tabs (overview/holdings/trades)

5. Phase 4 — Reporting (HTML tearsheet \+ storage)

6. Phase 5 — Multi-benchmark \+ benchmark overlap warning

7. Phase 6 — Auth (signup/signin/guest) \+ rate limiting

8. Phase 7 — Settings \+ search \+ notifications

9. Phase 8 — Data Health \+ ingestion/backfill UX

10. Phase 9 — Polish, performance indexes, reliability fixes (progress stuck, encoding)
