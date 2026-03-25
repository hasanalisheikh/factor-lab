"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { upsertUserSettings } from "@/lib/supabase/queries";

const RECOMMENDED_DEFAULTS = {
  default_universe: "ETF8" as const,
  default_benchmark: "SPY",
  default_costs_bps: 10,
  default_top_n: 10,
  default_initial_capital: 100000,
  default_rebalance_frequency: "Monthly" as const,
  default_date_range_years: 10,
  apply_costs_default: true,
  slippage_bps_default: 0,
};

const schema = z.object({
  default_universe: z.enum(["ETF8", "SP100", "NASDAQ100"]),
  default_benchmark: z.string().min(1),
  default_costs_bps: z.coerce.number().int().min(0).max(500),
  default_top_n: z.coerce.number().int().min(1).max(100),
  default_initial_capital: z.coerce
    .number()
    .int("Initial capital must be a whole number")
    .min(1_000, "Minimum $1,000")
    .max(10_000_000, "Maximum $10,000,000"),
  default_rebalance_frequency: z.enum(["Monthly", "Weekly"]),
  default_date_range_years: z.coerce.number().int().min(1).max(30),
  apply_costs_default: z.coerce
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  slippage_bps_default: z.coerce.number().int().min(0).max(500),
});

export type SaveSettingsState = { error?: string; success?: boolean } | null;

export async function saveSettingsAction(
  _prev: SaveSettingsState,
  formData: FormData
): Promise<SaveSettingsState> {
  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await upsertUserSettings(parsed.data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save settings." };
  }
  revalidatePath("/settings");
  revalidatePath("/runs/new");
  return { success: true };
}

export async function resetSettingsAction(
  _prev: SaveSettingsState,
  _formData: FormData
): Promise<SaveSettingsState> {
  try {
    await upsertUserSettings(RECOMMENDED_DEFAULTS);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reset settings." };
  }
  revalidatePath("/settings");
  revalidatePath("/runs/new");
  return { success: true };
}
