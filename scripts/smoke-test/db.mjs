import { createClient } from "@supabase/supabase-js";

import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  SMOKE_TEST_EMAIL,
  SUPABASE_KEY,
  SUPABASE_URL,
  UNIVERSE_PRESETS,
  WORKER_GITHUB_DISPATCH_TOKEN,
  WORKER_TRIGGER_SECRET,
  WORKER_TRIGGER_URL,
} from "./config.mjs";
import { log, sleep } from "./logging.mjs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export async function triggerWorker() {
  if (!WORKER_TRIGGER_URL) return;
  const isGitHub = WORKER_TRIGGER_URL.includes("api.github.com");
  const token = isGitHub ? WORKER_GITHUB_DISPATCH_TOKEN : WORKER_TRIGGER_SECRET;
  if (!token) {
    log(
      `Worker trigger skipped: missing ${
        isGitHub ? "WORKER_GITHUB_DISPATCH_TOKEN" : "WORKER_TRIGGER_SECRET"
      }`
    );
    return;
  }
  try {
    await fetch(isGitHub ? WORKER_TRIGGER_URL : `${WORKER_TRIGGER_URL}/trigger`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(isGitHub
          ? {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }
          : {}),
      },
      body: isGitHub ? JSON.stringify({ event_type: "run-worker" }) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Fire-and-forget — worker polls as fallback
  }
}

export async function getDataCoverage() {
  const [minRes, maxRes] = await Promise.all([
    supabase.from("prices").select("date").order("date", { ascending: true }).limit(1),
    supabase.from("prices").select("date").order("date", { ascending: false }).limit(1),
  ]);
  return {
    minDate: minRes.data?.[0]?.date ?? null,
    maxDate: maxRes.data?.[0]?.date ?? null,
  };
}

/** Ensure a test user exists in auth.users; return their UUID. */
export async function ensureTestUser() {
  const {
    data: { users },
    error: listErr,
  } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (!listErr && users) {
    const existing = users.find((u) => u.email === SMOKE_TEST_EMAIL);
    if (existing) return existing.id;
  }
  const {
    data: { user },
    error: createErr,
  } = await supabase.auth.admin.createUser({
    email: SMOKE_TEST_EMAIL,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (createErr || !user) throw new Error(`Could not create test user: ${createErr?.message}`);
  return user.id;
}

/** Create a run row + job row directly via service role, bypassing the Next.js action. */
export async function createTestRun(strategy, startDate, endDate, userId) {
  const name = `smoke-test-${strategy}-${Date.now()}`;
  const { data: run, error: runErr } = await supabase
    .from("runs")
    .insert({
      name,
      strategy_id: strategy,
      status: "queued",
      start_date: startDate,
      end_date: endDate,
      benchmark: "SPY",
      benchmark_ticker: "SPY",
      universe: "ETF8",
      universe_symbols: UNIVERSE_PRESETS.ETF8,
      costs_bps: 10,
      top_n: 4,
      user_id: userId,
      run_params: {
        universe: "ETF8",
        benchmark: "SPY",
        benchmark_ticker: "SPY",
        costs_bps: 10,
        top_n: 4,
        initial_capital: 100000,
        slippage_bps: 0,
        apply_costs: true,
        created_via: "smoke-test",
      },
    })
    .select("id")
    .single();

  if (runErr || !run) throw new Error(`Run insert failed: ${runErr?.message}`);

  const { error: jobErr } = await supabase.from("jobs").insert({
    run_id: run.id,
    name,
    status: "queued",
    stage: "ingest",
    progress: 0,
  });

  if (jobErr) {
    await supabase.from("runs").delete().eq("id", run.id);
    throw new Error(`Job insert failed: ${jobErr.message}`);
  }

  return { runId: run.id, name };
}

/** Poll until run.status is completed or failed, or timeout expires. */
export async function waitForCompletion(runId, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStage = null;
  let lastProgress = null;

  while (Date.now() < deadline) {
    const [runRes, jobRes] = await Promise.all([
      supabase.from("runs").select("status").eq("id", runId).single(),
      supabase
        .from("jobs")
        .select("status, stage, progress, error_message")
        .eq("run_id", runId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const runStatus = runRes.data?.status;
    const job = jobRes.data;

    const stage = job?.stage ?? "?";
    const progress = job?.progress ?? 0;
    if (stage !== lastStage || progress !== lastProgress) {
      log(label, `status=${runStatus} stage=${stage} progress=${progress}%`);
      lastStage = stage;
      lastProgress = progress;
    }

    if (runStatus === "completed") return { ok: true, job };
    if (runStatus === "failed") {
      return { ok: false, error: job?.error_message ?? "unknown failure", job };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { ok: false, error: `Timed out after ${POLL_TIMEOUT_MS / 1000}s` };
}

/** Assert all required DB outputs exist for a completed run. */
export async function assertOutputs(runId, label) {
  const failures = [];

  const [metricsRes, equityRes, positionsRes] = await Promise.all([
    supabase
      .from("run_metrics")
      .select("cagr,sharpe,max_drawdown")
      .eq("run_id", runId)
      .maybeSingle(),
    supabase
      .from("equity_curve")
      .select("date,portfolio,benchmark", { count: "exact" })
      .eq("run_id", runId)
      .limit(1),
    supabase
      .from("positions")
      .select("date,symbol,weight", { count: "exact" })
      .eq("run_id", runId)
      .limit(1),
  ]);

  // Metrics
  if (metricsRes.error || !metricsRes.data) {
    failures.push(`run_metrics missing (${metricsRes.error?.message ?? "no row"})`);
  } else {
    const m = metricsRes.data;
    if (!isFinite(m.cagr) || !isFinite(m.sharpe)) {
      failures.push(`run_metrics has non-finite values: cagr=${m.cagr} sharpe=${m.sharpe}`);
    }
  }

  // Equity curve
  if (equityRes.error) {
    failures.push(`equity_curve query failed: ${equityRes.error.message}`);
  } else if ((equityRes.count ?? 0) === 0) {
    failures.push("equity_curve is empty");
  } else {
    const row = equityRes.data?.[0];
    if (row?.benchmark == null) {
      failures.push("equity_curve rows have null benchmark values");
    }
  }

  // Positions
  if (positionsRes.error) {
    failures.push(`positions query failed: ${positionsRes.error.message}`);
  } else if ((positionsRes.count ?? 0) === 0) {
    failures.push("positions table is empty for this run");
  }

  if (failures.length > 0) {
    log(label, `ASSERTION FAILURES:\n  - ${failures.join("\n  - ")}`);
    return false;
  }

  log(
    label,
    `outputs OK (metrics ✓, equity_curve count=${equityRes.count} ✓, positions count=${positionsRes.count} ✓)`
  );
  return true;
}

/** Cleanup test runs after the suite completes. */
export async function cleanupRuns(runIds) {
  if (runIds.length === 0) return;
  const { error } = await supabase.from("runs").delete().in("id", runIds);
  if (error) {
    log("cleanup", `WARNING: could not delete test runs: ${error.message}`);
  } else {
    log("cleanup", `Deleted ${runIds.length} test run(s)`);
  }
}
