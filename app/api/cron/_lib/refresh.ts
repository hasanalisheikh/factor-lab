import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildScheduledRefreshWindow,
  getLastCompleteTradingDayUtc,
  getRequiredTickers,
  isDailyUpdatesEnabled,
  type DataUpdateMode,
} from "@/lib/data-cutoff";
import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import {
  isMissingDataIngestExtendedColumnError,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs";
import { TICKER_INCEPTION_DATES } from "@/lib/supabase/types";
import { triggerWorker } from "@/lib/worker-trigger";
import { randomUUID } from "crypto";

type TickerStatsRow = {
  symbol: string;
  last_date: string | null;
  row_count: number | null;
};

type ExistingBatchRow = {
  id: string;
  symbol: string;
  status: string;
  batch_id: string | null;
};

async function assertAuthorized(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron secret not configured." }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export async function runScheduledRefresh(
  request: NextRequest,
  requestMode: Extract<DataUpdateMode, "monthly" | "daily">
): Promise<NextResponse> {
  const authError = await assertAuthorized(request);
  if (authError) return authError;

  if (requestMode === "daily" && !isDailyUpdatesEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "daily_updates_disabled",
      mode: requestMode,
      targetCutoffDate: getLastCompleteTradingDayUtc(),
    });
  }

  const admin = createAdminClient();
  const targetCutoffDate = getLastCompleteTradingDayUtc();
  const requiredTickers = getRequiredTickers();
  const { data: currentState } = await admin
    .from("data_state")
    .select("data_cutoff_date, update_mode")
    .eq("id", 1)
    .maybeSingle();
  const currentCutoffDate =
    (currentState as { data_cutoff_date?: string } | null)?.data_cutoff_date ?? null;
  const currentUpdateMode = (currentState as { update_mode?: string } | null)?.update_mode ?? null;

  console.log(
    `[cron:${requestMode}] start target=${targetCutoffDate} current=${currentCutoffDate ?? "none"}`
  );

  // ── No-op guard (daily only) ──────────────────────────────────────────────
  // The daily patch must not create ingest jobs when no new complete trading
  // day is available (weekends, market holidays, or already-current cutoff).
  //
  // getLastCompleteTradingDayUtc() always returns the most recent complete
  // weekday that is at least 1 calendar day in the past — so on Saturday and
  // Sunday it returns Friday, which the Friday cron already processed.
  //
  // If targetCutoffDate <= currentCutoffDate the dataset is already up to date.
  // Record the check timestamp (for UI "scheduler is alive" indicator) and
  // return without touching data_ingest_jobs.
  if (requestMode === "daily" && currentCutoffDate && targetCutoffDate <= currentCutoffDate) {
    await admin
      .from("data_state")
      .update({ last_noop_check_at: new Date().toISOString() })
      .eq("id", 1);
    console.log(
      `[cron:daily] no-op — target=${targetCutoffDate} already <= current=${currentCutoffDate}`
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "cutoff_already_current",
      mode: requestMode,
      targetCutoffDate,
      currentCutoffDate,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataIngestJobs = (admin as any).from("data_ingest_jobs");

  const { data: existingBatchRows, error: existingError } = (await dataIngestJobs
    .select("id, symbol, status, batch_id")
    .eq("request_mode", requestMode)
    .eq("target_cutoff_date", targetCutoffDate)
    .in("symbol", requiredTickers)) as {
    data: ExistingBatchRow[] | null;
    error: { message: string } | null;
  };

  if (existingError) {
    console.error(`[cron:${requestMode}] existing-batch query error:`, existingError.message);
    return NextResponse.json(
      { error: "Failed to inspect existing refresh jobs." },
      { status: 500 }
    );
  }

  const existingRows = existingBatchRows ?? [];
  const activeExisting = existingRows.filter(
    (row) => row.status === "queued" || row.status === "running" || row.status === "retrying"
  );

  if (activeExisting.length > 0) {
    console.log(
      `[cron:${requestMode}] refresh_already_active batchId=${activeExisting[0]?.batch_id ?? "?"} activeJobs=${activeExisting.length}`
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "refresh_already_active",
      mode: requestMode,
      batchId: activeExisting[0]?.batch_id ?? null,
      activeJobs: activeExisting.length,
      targetCutoffDate,
    });
  }

  // ── Self-heal: prices already cover target; advance data_state without re-queuing ──
  // Fires when a previous batch had blocked/failed jobs preventing finalization, but
  // benchmark ticker_stats.last_date already reaches targetCutoffDate.
  // Requires uncapped upsert_ticker_stats (migration 20260325).
  if (currentCutoffDate && targetCutoffDate > currentCutoffDate) {
    const { data: benchmarkStats } = await admin
      .from("ticker_stats")
      .select("symbol, last_date")
      .in("symbol", BENCHMARK_OPTIONS as unknown as string[]);
    const bmList = (benchmarkStats ?? []) as Array<{ symbol: string; last_date: string | null }>;
    const allBenchmarksCurrent =
      bmList.length >= BENCHMARK_OPTIONS.length &&
      bmList.every((r) => (r.last_date ?? "") >= targetCutoffDate);

    if (allBenchmarksCurrent) {
      const nowIso = new Date().toISOString();
      await admin.from("data_state").upsert({
        id: 1,
        data_cutoff_date: targetCutoffDate,
        last_update_at: nowIso,
        update_mode: requestMode,
        updated_by: `cron:${requestMode}-refresh:self-heal`,
      });
      for (const ticker of BENCHMARK_OPTIONS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).rpc("upsert_ticker_stats", { p_ticker: ticker });
      }
      console.log(
        `[cron:${requestMode}] self-healed data_state ${currentCutoffDate} → ${targetCutoffDate}`
      );
      return NextResponse.json({
        ok: true,
        skipped: false,
        reason: "self_healed",
        mode: requestMode,
        targetCutoffDate,
        previousCutoffDate: currentCutoffDate,
      });
    }
  }

  const existingSymbols = new Set(existingRows.map((row) => row.symbol));
  const allRequiredSymbolsPresent = requiredTickers.every((ticker) => existingSymbols.has(ticker));

  if (
    existingRows.length > 0 &&
    allRequiredSymbolsPresent &&
    existingRows.every((row) => row.status === "succeeded")
  ) {
    if (currentCutoffDate !== targetCutoffDate || currentUpdateMode !== requestMode) {
      const nowIso = new Date().toISOString();
      await admin.from("data_state").upsert({
        id: 1,
        data_cutoff_date: targetCutoffDate,
        last_update_at: nowIso,
        update_mode: requestMode,
        updated_by: `cron:${requestMode}-refresh`,
      });
      for (const ticker of requiredTickers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).rpc("upsert_ticker_stats", { p_ticker: ticker });
      }
    }

    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "refresh_already_succeeded",
      mode: requestMode,
      batchId: existingRows[0]?.batch_id ?? null,
      targetCutoffDate,
      finalizedFallback:
        currentCutoffDate !== targetCutoffDate || currentUpdateMode !== requestMode,
    });
  }

  const { data: statsRows, error: statsError } = (await admin
    .from("ticker_stats")
    .select("symbol, last_date, row_count")
    .in("symbol", requiredTickers)) as {
    data: TickerStatsRow[] | null;
    error: { message: string } | null;
  };

  if (statsError) {
    console.error(`[cron:${requestMode}] ticker_stats query error:`, statsError.message);
    return NextResponse.json({ error: "Failed to inspect ticker stats." }, { status: 500 });
  }

  const statsMap = new Map<string, TickerStatsRow>();
  for (const row of statsRows ?? []) {
    statsMap.set(row.symbol, row);
  }

  const batchId = randomUUID();
  const requestedBy = `cron:${requestMode}-refresh`;
  const jobsToInsert: Array<{
    symbol: string;
    start_date: string;
    end_date: string;
    status: string;
    stage: string;
    progress: number;
    request_mode: string;
    batch_id: string;
    target_cutoff_date: string;
    requested_by: string;
  }> = [];
  const skippedSymbols: string[] = [];

  for (const ticker of requiredTickers) {
    const stats = statsMap.get(ticker);
    const existingLastDate = stats && (stats.row_count ?? 0) > 0 ? (stats.last_date ?? null) : null;
    const inceptionDate = TICKER_INCEPTION_DATES[ticker] ?? "1993-01-01";
    const window = buildScheduledRefreshWindow({
      existingLastDate,
      inceptionDate,
      targetCutoffDate,
      requestMode,
    });

    if (window.startDate > window.endDate) {
      skippedSymbols.push(ticker);
      continue;
    }

    jobsToInsert.push({
      symbol: ticker,
      start_date: window.startDate,
      end_date: window.endDate,
      status: "queued",
      stage: "download",
      progress: 0,
      request_mode: requestMode,
      batch_id: batchId,
      target_cutoff_date: targetCutoffDate,
      requested_by: requestedBy,
    });
  }

  if (jobsToInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "nothing_to_queue",
      mode: requestMode,
      targetCutoffDate,
      skippedSymbols,
    });
  }

  let { error: insertError } = await dataIngestJobs.insert(jobsToInsert);
  if (insertError && isMissingDataIngestExtendedColumnError(insertError.message)) {
    // Extended columns (request_mode, batch_id, target_cutoff_date, …) not yet applied
    // to this environment — retry without them so the cron never returns 500 due to schema lag.
    console.warn(
      `[cron:${requestMode}] extended columns missing, retrying without them:`,
      insertError.message
    );
    const strippedJobs = jobsToInsert.map(stripExtendedDataIngestFields);
    ({ error: insertError } = await dataIngestJobs.insert(strippedJobs));
  }
  if (insertError) {
    console.error(`[cron:${requestMode}] insert error:`, insertError.message);
    return NextResponse.json({ error: "Failed to queue refresh jobs." }, { status: 500 });
  }

  console.log(
    `[cron:${requestMode}] queued batch=${batchId} jobs=${jobsToInsert.length} skipped=${skippedSymbols.length} target=${targetCutoffDate} workerUrl=${Boolean(process.env.WORKER_TRIGGER_URL)}`
  );
  await triggerWorker(`cron.${requestMode}`);

  return NextResponse.json({
    ok: true,
    skipped: false,
    mode: requestMode,
    batchId,
    targetCutoffDate,
    queuedJobs: jobsToInsert.length,
    skippedSymbols,
  });
}
