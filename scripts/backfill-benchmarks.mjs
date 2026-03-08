#!/usr/bin/env node
// One-time script: queue historical backfill jobs for QQQ and IWM from 2015-01-02.
// Run with: node scripts/backfill-benchmarks.mjs

import { createClient } from "@supabase/supabase-js"

const COVERAGE_WINDOW_START = "2015-01-02"
const TICKERS = ["QQQ", "IWM"]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const supabase = createClient(url, key)
const today = new Date().toISOString().slice(0, 10)

for (const ticker of TICKERS) {
  // Check earliest stored date
  const { data: minRow } = await supabase
    .from("prices")
    .select("date")
    .eq("ticker", ticker)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle()

  const earliest = minRow?.date ?? null
  console.log(`${ticker}: earliest stored date = ${earliest ?? "none"}`)

  if (earliest && earliest <= COVERAGE_WINDOW_START) {
    console.log(`  → Already backfilled from ${COVERAGE_WINDOW_START}, skipping.`)
    continue
  }

  // Check for active jobs
  const { data: activeJobs } = await supabase
    .from("jobs")
    .select("id, status, created_at")
    .eq("job_type", "data_ingest")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(20)

  const _alreadyActive = (activeJobs ?? []).some(
    (j) => j.status === "queued" || j.status === "running"
    // Note: we can't filter by ticker here without checking payload, so we'll just proceed
  )

  // Insert backfill job
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      name: `Ingest ${ticker} (backfill from ${COVERAGE_WINDOW_START})`,
      status: "queued",
      stage: "download",
      progress: 0,
      job_type: "data_ingest",
      payload: { ticker, start_date: COVERAGE_WINDOW_START, end_date: today },
    })
    .select("id")
    .single()

  if (error || !job) {
    console.error(`  ✗ Failed to queue ${ticker}: ${error?.message}`)
  } else {
    console.log(`  ✓ Queued job ${job.id} for ${ticker} from ${COVERAGE_WINDOW_START} to ${today}`)
  }
}

console.log("\nDone. Check /jobs in the UI to monitor progress.")
