"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"

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
    benchmark_ticker: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z.\-]{1,10}$/, "Benchmark must be a valid ticker"),
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

export type CreateRunState = { error: string } | null

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
    benchmark_ticker,
    universe,
    costs_bps,
    top_n,
  } = parsed.data

  const supabase = createAdminClient()

  const { data: run, error: runError } = await supabase
    .from("runs")
    .insert({
      name,
      strategy_id,
      status: "queued",
      start_date,
      end_date,
      benchmark_ticker,
      universe,
      costs_bps,
      top_n,
      run_params: {
        universe,
        benchmark_ticker,
        costs_bps,
        top_n,
        created_via: "runs/new",
      },
    })
    .select("id")
    .single()

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
