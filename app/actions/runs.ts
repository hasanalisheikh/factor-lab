"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"

const schema = z
  .object({
    name: z.string().min(1, "Name is required").max(120, "Name too long"),
    strategy_id: z.enum(
      ["equal_weight", "momentum_12_1", "ml_ridge", "ml_lightgbm"],
      { message: "Select a valid strategy" }
    ),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date"),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date"),
    benchmark: z.enum(BENCHMARK_OPTIONS),
    universe: z.enum(["ETF8", "SP100", "NASDAQ100"]).default("ETF8"),
    costs_bps: z.coerce
      .number({ invalid_type_error: "Costs must be a number" })
      .min(0, "Costs must be >= 0 bps")
      .max(500, "Costs too high"),
    top_n: z.coerce
      .number({ invalid_type_error: "Top N must be a number" })
      .int("Top N must be an integer")
      .min(1, "Top N must be at least 1")
      .max(100, "Top N too high"),
  })
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(d.start_date + "T00:00:00Z")
      const end = new Date(d.end_date + "T00:00:00Z")
      const spanDays = Math.floor(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      )
      return spanDays >= 730
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  )

export type CreateRunState = { error: string } | null

function isMissingBenchmarkColumnError(message?: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes("benchmark") && m.includes("does not exist")
}

export async function createRun(
  _prev: CreateRunState,
  formData: FormData
): Promise<CreateRunState> {
  const raw = Object.fromEntries(formData)
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const {
    name,
    strategy_id,
    start_date,
    end_date,
    benchmark,
    universe,
    costs_bps,
    top_n,
  } = parsed.data

  const supabase = createAdminClient()

  const basePayload = {
    name,
    strategy_id,
    status: "queued",
    start_date,
    end_date,
    benchmark_ticker: benchmark,
    universe,
    costs_bps,
    top_n,
    run_params: {
      universe,
      benchmark,
      benchmark_ticker: benchmark,
      costs_bps,
      top_n,
      created_via: "runs/new",
    },
  }

  let { data: run, error: runError } = await supabase
    .from("runs")
    .insert({
      ...basePayload,
      benchmark,
    })
    .select("id")
    .single()

  if (runError && isMissingBenchmarkColumnError(runError.message)) {
    const fallback = await supabase
      .from("runs")
      .insert(basePayload)
      .select("id")
      .single()
    run = fallback.data
    runError = fallback.error
  }

  if (runError || !run) {
    console.error("createRun insert error:", runError?.message)
    return { error: "Failed to create run. Check server env + database config." }
  }

  const { error: jobError } = await supabase.from("jobs").insert({
    run_id: run.id,
    name,
    status: "queued",
    stage: "ingest",
    progress: 0,
  })

  if (jobError) {
    console.error("createRun job insert error:", jobError.message)
    // Run was created — don't fail, just log
  }

  redirect(`/runs/${run.id}`)
}
