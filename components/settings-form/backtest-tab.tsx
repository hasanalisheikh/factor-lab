"use client";

import { useActionState, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import {
  resetSettingsAction,
  saveSettingsAction,
  type SaveSettingsState,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import type { UserSettings } from "@/lib/supabase/types";
import { ALL_UNIVERSES } from "@/lib/universe-config";
import { cn } from "@/lib/utils";

import { ErrorAlert, SuccessAlert } from "./alerts";
import {
  CAPITAL_DEFAULT,
  CAPITAL_MAX,
  CAPITAL_MIN,
  CAPITAL_PRESETS,
  DATE_RANGE_OPTIONS,
  REBALANCE_OPTIONS,
} from "./constants";

// ─── Backtest defaults tab ────────────────────────────────────────────────────

export function BacktestTab({ defaults }: { defaults: UserSettings | null }) {
  const [saveState, saveAction, savePending] = useActionState<SaveSettingsState, FormData>(
    saveSettingsAction,
    null
  );
  const [resetState, resetAction, resetPending] = useActionState<SaveSettingsState, FormData>(
    resetSettingsAction,
    null
  );

  const isPending = savePending || resetPending;
  const successState = saveState?.success || resetState?.success;
  const errorState = saveState?.error || resetState?.error;

  const [applyCosts, setApplyCosts] = useState(defaults?.apply_costs_default ?? true);

  const [capitalDisplay, setCapitalDisplay] = useState(
    (defaults?.default_initial_capital ?? CAPITAL_DEFAULT).toLocaleString("en-US")
  );
  const [capitalValue, setCapitalValue] = useState(
    defaults?.default_initial_capital ?? CAPITAL_DEFAULT
  );
  const [capitalError, setCapitalError] = useState<string | null>(null);

  function handleCapitalChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCapitalDisplay(e.target.value);
    setCapitalError(null);
  }

  function handleCapitalBlur() {
    const cleaned = capitalDisplay.replace(/,/g, "").trim();
    const n = Math.round(Number(cleaned));
    if (!cleaned || !Number.isFinite(n) || isNaN(n)) {
      setCapitalValue(CAPITAL_DEFAULT);
      setCapitalDisplay(CAPITAL_DEFAULT.toLocaleString("en-US"));
      setCapitalError("Invalid amount — reverted to $100,000.");
      return;
    }
    const clamped = Math.max(CAPITAL_MIN, Math.min(CAPITAL_MAX, n));
    setCapitalValue(clamped);
    setCapitalDisplay(clamped.toLocaleString("en-US"));
    setCapitalError(null);
  }

  function setCapitalPreset(value: number) {
    setCapitalValue(value);
    setCapitalDisplay(value.toLocaleString("en-US"));
    setCapitalError(null);
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-5 pt-5 pb-3">
        <CardTitle className="text-card-foreground text-[13px] font-medium">
          Default Backtest Parameters
        </CardTitle>
        <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
          These values pre-fill every new backtest run.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={saveAction} className="flex flex-col gap-4">
          {/* Universe + Benchmark */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-[12px] font-medium">Universe</Label>
              <NativeSelect
                name="default_universe"
                defaultValue={defaults?.default_universe ?? "ETF8"}
                hasValue
                className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
              >
                {ALL_UNIVERSES.map((u) => (
                  <option key={u} value={u} className="text-foreground">
                    {u}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-[12px] font-medium">Benchmark</Label>
              <NativeSelect
                name="default_benchmark"
                defaultValue={defaults?.default_benchmark ?? "SPY"}
                hasValue
                className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
              >
                {BENCHMARK_OPTIONS.map((b) => (
                  <option key={b} value={b} className="text-foreground">
                    {b}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {/* Costs + Top N */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="default_costs_bps"
                className="text-muted-foreground text-[12px] font-medium"
              >
                Costs (bps)
              </Label>
              <Input
                id="default_costs_bps"
                name="default_costs_bps"
                type="number"
                min={0}
                max={500}
                step={1}
                defaultValue={defaults?.default_costs_bps ?? 10}
                className="bg-secondary/40 border-border h-8 text-[13px]"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="default_top_n"
                className="text-muted-foreground text-[12px] font-medium"
              >
                Top N
              </Label>
              <Input
                id="default_top_n"
                name="default_top_n"
                type="number"
                min={1}
                max={100}
                step={1}
                defaultValue={defaults?.default_top_n ?? 10}
                className="bg-secondary/40 border-border h-8 text-[13px]"
                required
              />
            </div>
          </div>

          {/* Initial capital */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="default_initial_capital"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Initial Capital ($)
            </Label>
            <input type="hidden" name="default_initial_capital" value={capitalValue} />
            <div className="flex gap-2">
              <Input
                id="default_initial_capital"
                type="text"
                inputMode="numeric"
                value={capitalDisplay}
                onChange={handleCapitalChange}
                onBlur={handleCapitalBlur}
                className="bg-secondary/40 border-border h-8 min-w-0 flex-1 text-[13px]"
              />
              <div className="flex shrink-0 gap-1">
                {CAPITAL_PRESETS.map(({ label, value }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCapitalPreset(value)}
                    className={cn(
                      "border-border bg-secondary/40 h-8 px-2.5 text-[11px] font-medium",
                      capitalValue === value &&
                        "border-emerald-700 bg-emerald-950/30 text-emerald-400"
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            {capitalError && <p className="text-destructive text-[11px]">{capitalError}</p>}
          </div>

          {/* Date range + Rebalance */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-[12px] font-medium">Date Range</Label>
              <NativeSelect
                name="default_date_range_years"
                defaultValue={String(defaults?.default_date_range_years ?? 5)}
                hasValue
                className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
              >
                {DATE_RANGE_OPTIONS.map((y) => (
                  <option key={y} value={String(y)} className="text-foreground">
                    {y}Y
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-[12px] font-medium">Rebalance</Label>
              <NativeSelect
                name="default_rebalance_frequency"
                defaultValue={defaults?.default_rebalance_frequency ?? "Monthly"}
                hasValue
                className="border-border bg-secondary/40 h-8 pr-8 pl-3 text-[13px]"
              >
                {REBALANCE_OPTIONS.map((f) => (
                  <option key={f} value={f} className="text-foreground">
                    {f}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <Separator className="bg-border/50 my-1" />

          {/* Apply costs toggle */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor="apply_costs_toggle"
                className="text-foreground cursor-pointer text-[12px] font-medium"
              >
                Apply transaction costs
              </Label>
              <span className="text-muted-foreground text-[11px]">
                Include costs_bps in every new run by default
              </span>
            </div>
            <input type="hidden" name="apply_costs_default" value={applyCosts ? "on" : ""} />
            <Switch
              id="apply_costs_toggle"
              checked={applyCosts}
              onCheckedChange={setApplyCosts}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

          {/* Slippage */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="slippage_bps_default"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Slippage (bps)
            </Label>
            <Input
              id="slippage_bps_default"
              name="slippage_bps_default"
              type="number"
              min={0}
              max={500}
              step={1}
              defaultValue={defaults?.slippage_bps_default ?? 0}
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>

          {/* Feedback */}
          {errorState && <ErrorAlert message={errorState} />}
          {successState && (
            <SuccessAlert message="Settings saved. New runs will use these defaults." />
          )}

          {/* Actions row */}
          <div className="mt-1 flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-8 flex-1 text-[12px] font-medium"
            >
              {savePending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save defaults"
              )}
            </Button>
          </div>
        </form>

        {/* Reset is a separate form so it doesn't share submit state */}
        <form action={resetAction} className="mt-2">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground h-7 w-full text-[11px]"
          >
            {resetPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Reset to recommended defaults
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
