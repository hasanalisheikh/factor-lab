"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarIcon, Zap } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { createRun, type CreateRunState } from "@/app/actions/runs"
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import type { UserSettings } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

const STRATEGIES = Object.entries(STRATEGY_LABELS) as [StrategyId, string][]
const UNIVERSE_PRESETS = ["ETF8", "SP100", "NASDAQ100"] as const
// Total asset count per preset (including benchmark symbol within ETF8).
// Used to derive the Top N upper bound shown in the UI.
const UNIVERSE_SIZES: Record<string, number> = {
  ETF8: 8,
  SP100: 20,
  NASDAQ100: 20,
}
const CAPITAL_MIN = 1_000
const CAPITAL_MAX = 10_000_000
const CAPITAL_DEFAULT = 100_000
const CAPITAL_PRESETS = [
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1m", value: 1_000_000 },
] as const

function toInputDate(d: Date | undefined) {
  return d ? format(d, "yyyy-MM-dd") : ""
}

// Parse a YYYY-MM-DD string as a local-timezone Date (avoids UTC-offset bugs).
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number)
  return new Date(y, m - 1, d)
}

type DataCoverage = {
  minDateStr: string
  maxDateStr: string
}

type Props = {
  defaults: UserSettings | null
  dataCoverage?: DataCoverage | null
}

export function RunForm({ defaults, dataCoverage }: Props) {
  const coverageMin = dataCoverage ? parseLocalDate(dataCoverage.minDateStr) : null
  const coverageMax = dataCoverage ? parseLocalDate(dataCoverage.maxDateStr) : null

  const [strategy, setStrategy] = useState<string>("")
  const [universe, setUniverse] = useState<string>(defaults?.default_universe ?? "ETF8")
  const [state, formAction, isPending] = useActionState<CreateRunState, FormData>(
    createRun,
    null
  )
  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    const yearsBack = defaults?.default_date_range_years ?? 5
    if (coverageMax) {
      const candidate = new Date(coverageMax)
      candidate.setFullYear(candidate.getFullYear() - yearsBack)
      return coverageMin && candidate < coverageMin ? new Date(coverageMin) : candidate
    }
    const d = new Date()
    d.setFullYear(d.getFullYear() - yearsBack)
    return d
  })
  const [endDate, setEndDate] = useState<Date | undefined>(
    () => coverageMax ?? new Date()
  )
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)

  const topNMax = UNIVERSE_SIZES[universe] ?? 20

  const [applyCosts, setApplyCosts] = useState(defaults?.apply_costs_default ?? true)

  const [capitalDisplay, setCapitalDisplay] = useState(
    (defaults?.default_initial_capital ?? CAPITAL_DEFAULT).toLocaleString("en-US")
  )
  const [capitalValue, setCapitalValue] = useState(
    defaults?.default_initial_capital ?? CAPITAL_DEFAULT
  )

  function handleCapitalChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCapitalDisplay(e.target.value)
  }

  function handleCapitalBlur() {
    const cleaned = capitalDisplay.replace(/,/g, "").trim()
    const n = Math.round(Number(cleaned))
    if (!cleaned || !Number.isFinite(n) || isNaN(n)) {
      setCapitalValue(CAPITAL_DEFAULT)
      setCapitalDisplay(CAPITAL_DEFAULT.toLocaleString("en-US"))
      return
    }
    const clamped = Math.max(CAPITAL_MIN, Math.min(CAPITAL_MAX, n))
    setCapitalValue(clamped)
    setCapitalDisplay(clamped.toLocaleString("en-US"))
  }

  function setCapitalPreset(value: number) {
    setCapitalValue(value)
    setCapitalDisplay(value.toLocaleString("en-US"))
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-1">
        <Link href="/runs">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Back to runs"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h2 className="text-base font-semibold text-foreground">New Backtest Run</h2>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3 px-5 pt-5">
          <CardTitle className="text-[13px] font-medium text-card-foreground">
            Configure Run
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <form action={formAction} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="name"
                className="text-[12px] font-medium text-muted-foreground"
              >
                Run name
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Momentum 2015–2020"
                className="h-8 text-[13px] bg-secondary/40 border-border"
                required
              />
            </div>

            {/* Strategy */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Strategy
              </Label>
              <NativeSelect
                name="strategy_id"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                required
                hasValue={!!strategy}
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                <option value="" disabled>
                  Select a strategy...
                </option>
                {STRATEGIES.map(([id, label]) => (
                  <option key={id} value={id} className="text-foreground">
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* Universe */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Universe
              </Label>
              <NativeSelect
                name="universe"
                value={universe}
                onChange={(e) => setUniverse(e.target.value)}
                required
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                {UNIVERSE_PRESETS.map((preset) => (
                  <option key={preset} value={preset} className="text-foreground">
                    {preset}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label className="text-[12px] font-medium text-muted-foreground">
                  Date range
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Min 2 years · 3+ recommended
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Start date */}
                <div>
                  <input type="hidden" name="start_date" value={toInputDate(startDate)} />
                  <Popover open={startOpen} onOpenChange={setStartOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-full justify-start text-[13px] bg-secondary/40 border-border font-normal"
                      >
                        <CalendarIcon className="mr-2 size-3.5 opacity-60" />
                        {startDate ? format(startDate, "MMM d, yyyy") : "Start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start" side="top" avoidCollisions={false}>
                      <Calendar
                        mode="single"
                        captionLayout="dropdown-years"
                        showOutsideDays={false}
                        startMonth={coverageMin ?? new Date(2015, 0)}
                        endMonth={coverageMax ?? new Date()}
                        selected={startDate}
                        onSelect={(d) => {
                          if (!d) return
                          if (dataCoverage) {
                            const s = format(d, "yyyy-MM-dd")
                            if (s < dataCoverage.minDateStr || s > dataCoverage.maxDateStr) return
                          }
                          setStartDate(d)
                          setStartOpen(false)
                        }}
                        disabled={(d) => {
                          const s = format(d, "yyyy-MM-dd")
                          return dataCoverage
                            ? s < dataCoverage.minDateStr || s > dataCoverage.maxDateStr
                            : d > new Date()
                        }}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                {/* End date */}
                <div>
                  <input type="hidden" name="end_date" value={toInputDate(endDate)} />
                  <Popover open={endOpen} onOpenChange={setEndOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 w-full justify-start text-[13px] bg-secondary/40 border-border font-normal"
                      >
                        <CalendarIcon className="mr-2 size-3.5 opacity-60" />
                        {endDate ? format(endDate, "MMM d, yyyy") : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start" side="top" avoidCollisions={false}>
                      <Calendar
                        mode="single"
                        captionLayout="dropdown-years"
                        showOutsideDays={false}
                        startMonth={coverageMin ?? new Date(2015, 0)}
                        endMonth={coverageMax ?? new Date()}
                        selected={endDate}
                        onSelect={(d) => {
                          if (!d) return
                          if (dataCoverage) {
                            const s = format(d, "yyyy-MM-dd")
                            if (s < dataCoverage.minDateStr || s > dataCoverage.maxDateStr) return
                          }
                          setEndDate(d)
                          setEndOpen(false)
                        }}
                        disabled={(d) => {
                          const s = format(d, "yyyy-MM-dd")
                          return dataCoverage
                            ? s < dataCoverage.minDateStr || s > dataCoverage.maxDateStr
                            : d > new Date()
                        }}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {dataCoverage && (
                <p className="text-[11px] text-muted-foreground">
                  Available data: {dataCoverage.minDateStr} → {dataCoverage.maxDateStr}
                </p>
              )}
            </div>

            {/* Initial capital */}
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="initial_capital"
                className="text-[12px] font-medium text-muted-foreground"
              >
                Initial Capital ($)
              </Label>
              <input type="hidden" name="initial_capital" value={capitalValue} />
              <div className="flex gap-2">
                <Input
                  id="initial_capital"
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
            </div>

            {/* Execution config */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="benchmark"
                  className="text-[12px] font-medium text-muted-foreground"
                >
                  Benchmark
                </Label>
                <NativeSelect
                  id="benchmark"
                  name="benchmark"
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
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="costs_bps"
                  className="text-[12px] font-medium text-muted-foreground"
                >
                  Costs (bps)
                </Label>
                <Input
                  id="costs_bps"
                  name="costs_bps"
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
                <Label
                  htmlFor="top_n"
                  className="text-[12px] font-medium text-muted-foreground"
                >
                  Top N
                </Label>
                <Input
                  id="top_n"
                  name="top_n"
                  type="number"
                  min={1}
                  max={topNMax}
                  step={1}
                  defaultValue={Math.min(defaults?.default_top_n ?? 5, topNMax)}
                  key={`top_n_${universe}`}
                  className="h-8 text-[13px] bg-secondary/40 border-border"
                  required
                />
                <span className="text-[11px] text-muted-foreground">Max {topNMax} for {universe}</span>
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
                  Deduct costs_bps from returns at each rebalance
                </span>
              </div>
              <input
                type="hidden"
                name="apply_costs"
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
              <Label
                htmlFor="slippage_bps"
                className="text-[12px] font-medium text-muted-foreground"
              >
                Slippage (bps)
                <span className="ml-1.5 text-[11px] font-normal opacity-60">optional</span>
              </Label>
              <Input
                id="slippage_bps"
                name="slippage_bps"
                type="number"
                min={0}
                max={500}
                step={1}
                defaultValue={defaults?.slippage_bps_default ?? 0}
                className="h-8 text-[13px] bg-secondary/40 border-border"
              />
            </div>

            {/* Error message */}
            {state?.error && (
              <p className="text-[12px] text-destructive bg-destructive/8 border border-destructive/20 rounded-md px-3 py-2">
                {state.error}
              </p>
            )}

            {/* Submit */}
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !strategy}
              className="h-8 text-[12px] font-medium mt-1 w-full"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {isPending ? "Queueing…" : "Queue Backtest"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
