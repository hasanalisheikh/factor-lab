import { z } from "zod";

import { BENCHMARK_OPTIONS } from "@/lib/benchmark";

export const baseRunConfigSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name too long"),
  strategy_id: z.enum(
    ["equal_weight", "momentum_12_1", "ml_ridge", "ml_lightgbm", "low_vol", "trend_filter"],
    { message: "Select a valid strategy" }
  ),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date"),
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
  initial_capital: z.coerce
    .number({ invalid_type_error: "Initial capital must be a number" })
    .positive("Initial capital must be positive")
    .max(1e10, "Initial capital too large")
    .default(100000),
  apply_costs: z.boolean().default(true),
  slippage_bps: z.coerce.number().min(0).max(500).default(0).catch(0),
});

export const runConfigSchema = baseRunConfigSchema
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(`${d.start_date}T00:00:00Z`);
      const end = new Date(`${d.end_date}T00:00:00Z`);
      const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return spanDays >= 730;
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  );

export const createRunSchema = baseRunConfigSchema
  .extend({
    acknowledge_warnings: z.boolean().default(false),
  })
  .refine((d) => d.end_date > d.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  })
  .refine(
    (d) => {
      const start = new Date(`${d.start_date}T00:00:00Z`);
      const end = new Date(`${d.end_date}T00:00:00Z`);
      const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return spanDays >= 730;
    },
    {
      message:
        "Date range must span at least 2 years (730 days) for a robust backtest. We recommend 3+ years.",
      path: ["start_date"],
    }
  );
