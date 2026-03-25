"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Copy, CopyCheck, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  saveSettingsAction,
  resetSettingsAction,
  type SaveSettingsState,
} from "@/app/actions/settings";
import {
  changePasswordAction,
  upgradeGuestAction,
  deleteAccountAction,
  type AccountActionState,
} from "@/app/actions/account";
import { BENCHMARK_OPTIONS } from "@/lib/benchmark";
import type { UserSettings } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { ALL_UNIVERSES } from "@/lib/universe-config";
const DATE_RANGE_OPTIONS = [1, 2, 3, 5, 7, 10] as const;
const REBALANCE_OPTIONS = ["Monthly", "Weekly"] as const;
const CAPITAL_MIN = 1_000;
const CAPITAL_MAX = 10_000_000;
const CAPITAL_DEFAULT = 100_000;
const CAPITAL_PRESETS = [
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1m", value: 1_000_000 },
] as const;

export type UserInfo = {
  id: string;
  email: string;
  is_guest: boolean;
};

type Props = {
  defaults: UserSettings | null;
  user: UserInfo;
  defaultTab?: string;
};

// ─── Feedback helpers ─────────────────────────────────────────────────────────

function ErrorAlert({ message }: { message: string }) {
  return (
    <p className="text-destructive bg-destructive/8 border-destructive/20 rounded-md border px-3 py-2 text-[12px]">
      {message}
    </p>
  );
}

function SuccessAlert({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-md border border-emerald-800/40 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-400">
      <Check className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

// ─── Backtest defaults tab ────────────────────────────────────────────────────

function BacktestTab({ defaults }: { defaults: UserSettings | null }) {
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

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CopyCheck className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ─── Change password form ─────────────────────────────────────────────────────

function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    changePasswordAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current_password" className="text-muted-foreground text-[12px] font-medium">
          Current password
        </Label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new_password" className="text-muted-foreground text-[12px] font-medium">
          New password
        </Label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          placeholder="Min 8 chars, 1 uppercase, 1 special"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm_password" className="text-muted-foreground text-[12px] font-medium">
          Confirm password
        </Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat new password"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>

      {state?.error && <ErrorAlert message={state.error} />}
      {state?.success && <SuccessAlert message="Password updated successfully." />}

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="h-8 w-full text-[12px] font-medium"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Updating…
          </>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  );
}

// ─── Guest upgrade form ───────────────────────────────────────────────────────

function GuestUpgradeForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    upgradeGuestAction,
    null
  );

  return (
    <Card className="bg-card border-emerald-900/40">
      <CardHeader className="px-5 pt-5 pb-3">
        <CardTitle className="text-[13px] font-medium text-emerald-400">
          Upgrade guest account
        </CardTitle>
        <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
          Add an email and password to keep your runs permanently. Your existing data is preserved.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_email"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Email
            </Label>
            <Input
              id="upgrade_email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_password"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Password
            </Label>
            <Input
              id="upgrade_password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Min 8 chars, 1 uppercase, 1 special"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_confirm"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Confirm password
            </Label>
            <Input
              id="upgrade_confirm"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="h-8 w-full bg-emerald-700 text-[12px] font-medium text-white hover:bg-emerald-600"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Upgrading…
              </>
            ) : (
              "Upgrade account"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

function DangerZone({ isGuest }: { isGuest: boolean }) {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    deleteAccountAction,
    null
  );
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = confirmText === "DELETE" && (isGuest || password.length > 0);

  return (
    <Card className="bg-card border-destructive/30">
      <CardHeader className="px-5 pt-5 pb-3">
        <CardTitle className="text-destructive flex items-center gap-1.5 text-[13px] font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          Danger Zone
        </CardTitle>
        <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
          Permanently deletes all your runs, reports, and account data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          {!isGuest && (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="delete_password"
                className="text-muted-foreground text-[12px] font-medium"
              >
                Current password
              </Label>
              <Input
                id="delete_password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30 h-8 text-[13px]"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm_text" className="text-muted-foreground text-[12px] font-medium">
              Type <span className="text-destructive font-mono font-semibold">DELETE</span> to
              confirm
            </Label>
            <Input
              id="confirm_text"
              name="confirm_text"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30 h-8 text-[13px]"
              autoComplete="off"
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={isPending || !canSubmit}
            className="h-8 w-full text-[12px] font-medium"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete account permanently"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Account tab ──────────────────────────────────────────────────────────────

function AccountTab({ user }: { user: UserInfo }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-card-foreground text-[13px] font-medium">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5 pb-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Email
            </span>
            <span className="text-foreground text-[13px]">{user.email}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Account type
            </span>
            {user.is_guest ? (
              <Badge
                variant="outline"
                className="w-fit border-amber-700/50 bg-amber-950/20 text-[11px] text-amber-400"
              >
                Guest
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="w-fit border-emerald-700/50 bg-emerald-950/20 text-[11px] text-emerald-400"
              >
                User
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              User ID
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground truncate font-mono text-[12px]">
                {user.id}
              </span>
              <CopyButton text={user.id} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password change — only for authenticated (non-guest) users */}
      {!user.is_guest && (
        <Card className="bg-card border-border">
          <CardHeader className="px-5 pt-5 pb-3">
            <CardTitle className="text-card-foreground text-[13px] font-medium">Security</CardTitle>
            <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
              Change your account password.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ChangePasswordForm />
          </CardContent>
        </Card>
      )}

      {/* Guest upgrade */}
      {user.is_guest && <GuestUpgradeForm />}

      {/* Danger zone */}
      <DangerZone isGuest={user.is_guest} />
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function SettingsForm({ defaults, user, defaultTab }: Props) {
  const initialTab = defaultTab === "account" ? "account" : "backtest";
  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList className="h-8">
        <TabsTrigger value="backtest" className="h-6 px-3 text-[12px]">
          Backtest
        </TabsTrigger>
        <TabsTrigger value="account" className="h-6 px-3 text-[12px]">
          Account
        </TabsTrigger>
      </TabsList>

      <TabsContent value="backtest">
        <BacktestTab defaults={defaults} />
      </TabsContent>

      <TabsContent value="account">
        <AccountTab user={user} />
      </TabsContent>
    </Tabs>
  );
}
