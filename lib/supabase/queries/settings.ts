import "server-only";

import { createClient } from "../server";
import type { UserSettings } from "../types";

const USER_SETTINGS_SELECT = `
  user_id,
  default_universe,
  default_benchmark,
  default_costs_bps,
  default_top_n,
  default_initial_capital,
  default_rebalance_frequency,
  default_date_range_years,
  apply_costs_default,
  slippage_bps_default,
  updated_at
`;

export async function getUserSettings(): Promise<UserSettings | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("user_settings")
      .select(USER_SETTINGS_SELECT)
      .maybeSingle();

    if (error || !data) return null;
    return data as UserSettings;
  } catch (err) {
    console.error("getUserSettings exception:", err);
    return null;
  }
}

export async function upsertUserSettings(
  settings: Partial<Omit<UserSettings, "user_id" | "updated_at">>
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      ...settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(error.message);
}
