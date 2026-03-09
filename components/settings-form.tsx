"use client"

import { useActionState, useState } from "react"
import { Check, Loader2, Copy, CopyCheck, RotateCcw, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  saveSettingsAction,
  resetSettingsAction,
  type SaveSettingsState,
} from "@/app/actions/settings"
import {
  changePasswordAction,
  upgradeGuestAction,
  deleteAccountAction,
  type AccountActionState,
} from "@/app/actions/account"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import type { UserSettings } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"
import { ALL_UNIVERSES } from "@/lib/universe-config"
const DATE_RANGE_OPTIONS = [1, 2, 3, 5, 7, 10] as const
const REBALANCE_OPTIONS = ["Monthly", "Weekly"] as const
const CAPITAL_MIN = 1_000
const CAPITAL_MAX = 10_000_000
const CAPITAL_DEFAULT = 100_000
const CAPITAL_PRESETS = [
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1m", value: 1_000_000 },
] as const

export type UserInfo = {
  id: string
  email: string
  is_guest: boolean
}

type Props = {
  defaults: UserSettings | null
  user: UserInfo
  defaultTab?: string
}

// ─── Feedback helpers ─────────────────────────────────────────────────────────

function ErrorAlert({ message }: { message: string }) {
  return (
    <p className="text-[12px] text-destructive bg-destructive/8 border border-destructive/20 rounded-md px-3 py-2">
      {message}
    </p>
  )
}

function SuccessAlert({ message }: { message: string }) {
  return (
    <p className="text-[12px] text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded-md px-3 py-2 flex items-center gap-1.5">
      <Check className="w-3.5 h-3.5 shrink-0" />
      {message}
    </p>
  )
}

// ─── Backtest defaults tab ────────────────────────────────────────────────────

function BacktestTab({ defaults }: { defaults: UserSettings | null }) {
  const [saveState, saveAction, savePending] = useActionState<SaveSettingsState, FormData>(
    saveSettingsAction,
    null
  )
  const [resetState, resetAction, resetPending] = useActionState<SaveSettingsState, FormData>(
    resetSettingsAction,
    null
  )

  const isPending = savePending || resetPending
  const successState = saveState?.success || resetState?.success
  const errorState = saveState?.error || resetState?.error

  const [applyCosts, setApplyCosts] = useState(defaults?.apply_costs_default ?? true)

  const [capitalDisplay, setCapitalDisplay] = useState(
    (defaults?.default_initial_capital ?? CAPITAL_DEFAULT).toLocaleString("en-US")
  )
  const [capitalValue, setCapitalValue] = useState(
    defaults?.default_initial_capital ?? CAPITAL_DEFAULT
  )
  const [capitalError, setCapitalError] = useState<string | null>(null)

  function handleCapitalChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCapitalDisplay(e.target.value)
    setCapitalError(null)
  }

  function handleCapitalBlur() {
    const cleaned = capitalDisplay.replace(/,/g, "").trim()
    const n = Math.round(Number(cleaned))
    if (!cleaned || !Number.isFinite(n) || isNaN(n)) {
      setCapitalValue(CAPITAL_DEFAULT)
      setCapitalDisplay(CAPITAL_DEFAULT.toLocaleString("en-US"))
      setCapitalError("Invalid amount — reverted to $100,000.")
      return
    }
    const clamped = Math.max(CAPITAL_MIN, Math.min(CAPITAL_MAX, n))
    setCapitalValue(clamped)
    setCapitalDisplay(clamped.toLocaleString("en-US"))
    setCapitalError(null)
  }

  function setCapitalPreset(value: number) {
    setCapitalValue(value)
    setCapitalDisplay(value.toLocaleString("en-US"))
    setCapitalError(null)
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3 px-5 pt-5">
        <CardTitle className="text-[13px] font-medium text-card-foreground">
          Default Backtest Parameters
        </CardTitle>
        <CardDescription className="text-[12px] text-muted-foreground mt-0.5">
          These values pre-fill every new backtest run.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={saveAction} className="flex flex-col gap-4">
          {/* Universe + Benchmark */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Universe
              </Label>
              <NativeSelect
                name="default_universe"
                defaultValue={defaults?.default_universe ?? "ETF8"}
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                {ALL_UNIVERSES.map((u) => (
                  <option key={u} value={u} className="text-foreground">
                    {u}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Benchmark
              </Label>
              <NativeSelect
                name="default_benchmark"
                defaultValue={defaults?.default_benchmark ?? "SPY"}
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
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
              <Label htmlFor="default_costs_bps" className="text-[12px] font-medium text-muted-foreground">
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
                className="h-8 text-[13px] bg-secondary/40 border-border"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default_top_n" className="text-[12px] font-medium text-muted-foreground">
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
                className="h-8 text-[13px] bg-secondary/40 border-border"
                required
              />
            </div>
          </div>

          {/* Initial capital */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default_initial_capital" className="text-[12px] font-medium text-muted-foreground">
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
                className="h-8 text-[13px] bg-secondary/40 border-border flex-1 min-w-0"
              />
              <div className="flex gap-1 shrink-0">
                {CAPITAL_PRESETS.map(({ label, value }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCapitalPreset(value)}
                    className={cn(
                      "h-8 px-2.5 text-[11px] font-medium border-border bg-secondary/40",
                      capitalValue === value && "border-emerald-700 text-emerald-400 bg-emerald-950/30"
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            {capitalError && (
              <p className="text-[11px] text-destructive">{capitalError}</p>
            )}
          </div>

          {/* Date range + Rebalance */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Date Range
              </Label>
              <NativeSelect
                name="default_date_range_years"
                defaultValue={String(defaults?.default_date_range_years ?? 5)}
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                {DATE_RANGE_OPTIONS.map((y) => (
                  <option key={y} value={String(y)} className="text-foreground">
                    {y}Y
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Rebalance
              </Label>
              <NativeSelect
                name="default_rebalance_frequency"
                defaultValue={defaults?.default_rebalance_frequency ?? "Monthly"}
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                {REBALANCE_OPTIONS.map((f) => (
                  <option key={f} value={f} className="text-foreground">
                    {f}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <Separator className="my-1 bg-border/50" />

          {/* Apply costs toggle */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor="apply_costs_toggle"
                className="text-[12px] font-medium text-foreground cursor-pointer"
              >
                Apply transaction costs
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Include costs_bps in every new run by default
              </span>
            </div>
            <input
              type="hidden"
              name="apply_costs_default"
              value={applyCosts ? "on" : ""}
            />
            <Switch
              id="apply_costs_toggle"
              checked={applyCosts}
              onCheckedChange={setApplyCosts}
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>

          {/* Slippage */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slippage_bps_default" className="text-[12px] font-medium text-muted-foreground">
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
              className="h-8 text-[13px] bg-secondary/40 border-border"
              required
            />
          </div>

          {/* Feedback */}
          {errorState && <ErrorAlert message={errorState} />}
          {successState && (
            <SuccessAlert message="Settings saved. New runs will use these defaults." />
          )}

          {/* Actions row */}
          <div className="flex gap-2 mt-1">
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-8 text-[12px] font-medium flex-1"
            >
              {savePending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
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
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground w-full"
          >
            {resetPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <><RotateCcw className="w-3 h-3 mr-1.5" />Reset to recommended defaults</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CopyCheck className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  )
}

// ─── Change password form ─────────────────────────────────────────────────────

function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    changePasswordAction,
    null
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current_password" className="text-[12px] font-medium text-muted-foreground">
          Current password
        </Label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          className="h-8 text-[13px] bg-secondary/40 border-border"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new_password" className="text-[12px] font-medium text-muted-foreground">
          New password
        </Label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          placeholder="Min 8 chars, 1 uppercase, 1 special"
          className="h-8 text-[13px] bg-secondary/40 border-border"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm_password" className="text-[12px] font-medium text-muted-foreground">
          Confirm password
        </Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat new password"
          className="h-8 text-[13px] bg-secondary/40 border-border"
          required
        />
      </div>

      {state?.error && <ErrorAlert message={state.error} />}
      {state?.success && <SuccessAlert message="Password updated successfully." />}

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="h-8 text-[12px] font-medium w-full"
      >
        {isPending ? (
          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Updating…</>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  )
}

// ─── Guest upgrade form ───────────────────────────────────────────────────────

function GuestUpgradeForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    upgradeGuestAction,
    null
  )

  return (
    <Card className="bg-card border-emerald-900/40">
      <CardHeader className="pb-3 px-5 pt-5">
        <CardTitle className="text-[13px] font-medium text-emerald-400">
          Upgrade guest account
        </CardTitle>
        <CardDescription className="text-[12px] text-muted-foreground mt-0.5">
          Add an email and password to keep your runs permanently. Your existing data is preserved.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upgrade_email" className="text-[12px] font-medium text-muted-foreground">
              Email
            </Label>
            <Input
              id="upgrade_email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="h-8 text-[13px] bg-secondary/40 border-border"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upgrade_password" className="text-[12px] font-medium text-muted-foreground">
              Password
            </Label>
            <Input
              id="upgrade_password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              placeholder="Min 8 chars, 1 uppercase, 1 special"
              className="h-8 text-[13px] bg-secondary/40 border-border"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upgrade_confirm" className="text-[12px] font-medium text-muted-foreground">
              Confirm password
            </Label>
            <Input
              id="upgrade_confirm"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              className="h-8 text-[13px] bg-secondary/40 border-border"
              required
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="h-8 text-[12px] font-medium w-full bg-emerald-700 hover:bg-emerald-600 text-white"
          >
            {isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Upgrading…</>
            ) : (
              "Upgrade account"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

function DangerZone({ isGuest }: { isGuest: boolean }) {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    deleteAccountAction,
    null
  )
  const [confirmText, setConfirmText] = useState("")
  const [password, setPassword] = useState("")

  const canSubmit = confirmText === "DELETE" && (isGuest || password.length > 0)

  return (
    <Card className="bg-card border-destructive/30">
      <CardHeader className="pb-3 px-5 pt-5">
        <CardTitle className="text-[13px] font-medium text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Danger Zone
        </CardTitle>
        <CardDescription className="text-[12px] text-muted-foreground mt-0.5">
          Permanently deletes all your runs, reports, and account data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          {!isGuest && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete_password" className="text-[12px] font-medium text-muted-foreground">
                Current password
              </Label>
              <Input
                id="delete_password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-8 text-[13px] bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm_text" className="text-[12px] font-medium text-muted-foreground">
              Type{" "}
              <span className="font-mono text-destructive font-semibold">DELETE</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm_text"
              name="confirm_text"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-8 text-[13px] bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30"
              autoComplete="off"
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={isPending || !canSubmit}
            className="h-8 text-[12px] font-medium w-full"
          >
            {isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</>
            ) : (
              "Delete account permanently"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Account tab ──────────────────────────────────────────────────────────────

function AccountTab({ user }: { user: UserInfo }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 px-5 pt-5">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
              Email
            </span>
            <span className="text-[13px] text-foreground">{user.email}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
              Account type
            </span>
            {user.is_guest ? (
              <Badge
                variant="outline"
                className="w-fit border-amber-700/50 text-amber-400 bg-amber-950/20 text-[11px]"
              >
                Guest
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="w-fit border-emerald-700/50 text-emerald-400 bg-emerald-950/20 text-[11px]"
              >
                User
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
              User ID
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground font-mono truncate">
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
          <CardHeader className="pb-3 px-5 pt-5">
            <CardTitle className="text-[13px] font-medium text-card-foreground">
              Security
            </CardTitle>
            <CardDescription className="text-[12px] text-muted-foreground mt-0.5">
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
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function SettingsForm({ defaults, user, defaultTab }: Props) {
  const initialTab = defaultTab === "account" ? "account" : "backtest"
  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList className="h-8">
        <TabsTrigger value="backtest" className="text-[12px] px-3 h-6">
          Backtest
        </TabsTrigger>
        <TabsTrigger value="account" className="text-[12px] px-3 h-6">
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
  )
}
