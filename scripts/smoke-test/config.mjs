export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const WORKER_TRIGGER_URL = process.env.WORKER_TRIGGER_URL;
export const WORKER_GITHUB_DISPATCH_TOKEN = process.env.WORKER_GITHUB_DISPATCH_TOKEN;
export const WORKER_TRIGGER_SECRET = process.env.WORKER_TRIGGER_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

export const SMOKE_TEST_EMAIL = "smoke-test@factorlab.local";

const args = process.argv.slice(2);
const flagStrategies =
  args.find((a) => a.startsWith("--strategies=")) ?? args[args.indexOf("--strategies") + 1];
const flagTimeout =
  args.find((a) => a.startsWith("--timeout=")) ?? args[args.indexOf("--timeout") + 1];

const ALL_STRATEGIES = [
  "equal_weight",
  "momentum_12_1",
  "low_vol",
  "trend_filter",
  "ml_ridge",
  // ml_lightgbm excluded by default (requires LightGBM native lib)
  // Uncomment below or pass --strategies=...,ml_lightgbm to include it.
];

export const STRATEGIES_TO_TEST = flagStrategies
  ? String(flagStrategies)
      .replace("--strategies=", "")
      .split(",")
      .map((s) => s.trim())
  : ALL_STRATEGIES;

export const POLL_TIMEOUT_MS =
  (parseInt(String(flagTimeout ?? "").replace("--timeout=", ""), 10) || 300) * 1000; // default 300 seconds (5 min)

export const POLL_INTERVAL_MS = 3000;

// Universe presets (mirrors worker.py UNIVERSE_PRESETS)
export const UNIVERSE_PRESETS = {
  ETF8: ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"],
};
