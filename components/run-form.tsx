"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CalendarIcon, ChevronsLeft, ChevronsRight, RefreshCcw, Zap } from "lucide-react"
import { format } from "date-fns"
import {
  createRun,
  ensureUniverseDataReady,
  getUniverseBatchStatusAction,
  preflightRun,
  retryPreflightRepairs,
  type EnsureUniverseDataReadyResult,
  type RunConfigInput,
  type RunPreflightResult,
  type UniverseBatchStatusSummary,
} from "@/app/actions/runs"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { STRATEGY_LABELS, type StrategyId } from "@/lib/types"
import { BENCHMARK_OPTIONS } from "@/lib/benchmark"
import type { UserSettings } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"
import { ALL_UNIVERSES, UNIVERSE_SIZES, type UniverseId } from "@/lib/universe-config"
import {
  STRATEGY_WARMUP_CALENDAR_DAYS,
  STRATEGY_WARMUP_DESCRIPTIONS,
  computeStrategyEarliestStart,
} from "@/lib/strategy-warmup"

const STRATEGIES = Object.entries(STRATEGY_LABELS) as [StrategyId, string][]
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

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function resolveMinStartDate(
  universeEarliestStart: string | null,
  universeValidFrom: string | null
): string | null {
  if (universeEarliestStart && universeValidFrom) {
    return universeEarliestStart > universeValidFrom ? universeEarliestStart : universeValidFrom
  }
  return universeEarliestStart ?? universeValidFrom ?? null
}

type DataCoverage = {
  minDateStr: string
  maxDateStr: string
}

type Props = {
  defaults: UserSettings | null
  dataCoverage?: DataCoverage | null
  initialUniverseState: EnsureUniverseDataReadyResult
  diagnostics?: boolean
}

function formatPreflightPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function PreflightBenchmarkDiagnostics({
  result,
}: {
  result: RunPreflightResult
}) {
  const benchmark = result.coverage.benchmark
  if (!benchmark.windowStartUsed || !benchmark.windowEndUsed) return null

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Benchmark Diagnostics
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <span className="text-muted-foreground">Window</span>
        <span className="font-mono text-foreground">
          {benchmark.windowStartUsed} to {benchmark.windowEndUsed}
        </span>
        <span className="text-muted-foreground">Source</span>
        <span className="font-mono text-foreground">{benchmark.metricSourceUsed}</span>
        <span className="text-muted-foreground">Expected days</span>
        <span className="font-mono text-foreground">{benchmark.expectedDays}</span>
        <span className="text-muted-foreground">Actual days</span>
        <span className="font-mono text-foreground">{benchmark.actualDays}</span>
        <span className="text-muted-foreground">Missing days</span>
        <span className="font-mono text-foreground">{benchmark.missingDays}</span>
        <span className="text-muted-foreground">True missing rate</span>
        <span className="font-mono text-foreground">{formatPreflightPercent(benchmark.trueMissingRate)}</span>
      </div>
    </div>
  )
}

function YearPickCalendar({
  startMonth,
  endMonth,
  selected,
  onSelect,
  disabled,
  autoFocus,
}: {
  startMonth?: Date
  endMonth?: Date
  selected?: Date
  onSelect: (d: Date | undefined) => void
  disabled?: (d: Date) => boolean
  autoFocus?: boolean
}) {
  const [yearPickMode, setYearPickMode] = useState(false)
  const [displayMonth, setDisplayMonth] = useState<Date>(selected ?? startMonth ?? new Date())

  const startYear = startMonth?.getFullYear() ?? 2015
  const endYear = endMonth?.getFullYear() ?? new Date().getFullYear()

  const prevMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1)
  const nextMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1)
  const prevYear = new Date(displayMonth.getFullYear() - 1, displayMonth.getMonth())
  const nextYear = new Date(displayMonth.getFullYear() + 1, displayMonth.getMonth())
  const canPrevMonth = !startMonth || prevMonth >= new Date(startMonth.getFullYear(), startMonth.getMonth())
  const canNextMonth = !endMonth || nextMonth <= new Date(endMonth.getFullYear(), endMonth.getMonth())
  const canPrevYear = !startMonth || prevYear >= new Date(startMonth.getFullYear(), startMonth.getMonth())
  const canNextYear = !endMonth || nextYear <= new Date(endMonth.getFullYear(), endMonth.getMonth())

  return (
    <div className="p-3">
      {/* Custom nav header */}
      <div className="flex items-center justify-between mb-2 h-8">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => canPrevYear && setDisplayMonth(prevYear)}
            disabled={!canPrevYear}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous year"
          >
            <ChevronsLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => canPrevMonth && setDisplayMonth(prevMonth)}
            disabled={!canPrevMonth}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous month"
          >
            <ChevronsLeft className="size-3 -ml-2" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setYearPickMode((v) => !v)}
          className="text-sm font-medium px-2 py-0.5 rounded hover:bg-accent transition-colors"
          title="Pick a year"
        >
          {format(displayMonth, yearPickMode ? "yyyy" : "MMMM yyyy")}
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => canNextMonth && setDisplayMonth(nextMonth)}
            disabled={!canNextMonth}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next month"
          >
            <ChevronsRight className="size-3 -mr-2" />
          </button>
          <button
            type="button"
            onClick={() => canNextYear && setDisplayMonth(nextYear)}
            disabled={!canNextYear}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next year"
          >
            <ChevronsRight className="size-3.5" />
          </button>
        </div>
      </div>

      {yearPickMode ? (
        /* Year grid */
        <div className="grid grid-cols-4 gap-1 w-[220px]">
          {Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i).map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => {
                setDisplayMonth(new Date(year, displayMonth.getMonth()))
                setYearPickMode(false)
              }}
              className={cn(
                "py-1.5 text-sm rounded-md transition-colors",
                year === displayMonth.getFullYear()
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {year}
            </button>
          ))}
        </div>
      ) : (
        /* Calendar grid — navigation hidden since we handle it above */
        <Calendar
          mode="single"
          showOutsideDays={false}
          hideNavigation
          captionLayout="label"
          startMonth={startMonth}
          endMonth={endMonth}
          month={displayMonth}
          onMonthChange={setDisplayMonth}
          selected={selected}
          onSelect={onSelect}
          disabled={disabled}
          autoFocus={autoFocus}
          className="p-0"
        />
      )}
    </div>
  )
}

export function RunForm({ defaults, dataCoverage, initialUniverseState, diagnostics = false }: Props) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const lastLoadedUniverseRef = useRef(initialUniverseState.constraints.universe)
  const coverageMin = dataCoverage ? parseLocalDate(dataCoverage.minDateStr) : null
  const initialMaxEndDate = initialUniverseState.constraints.dataCutoffDate ?? dataCoverage?.maxDateStr ?? null
  const initialMinStartDate = resolveMinStartDate(
    initialUniverseState.constraints.universeEarliestStart,
    initialUniverseState.constraints.universeValidFrom,
  )

  const [strategy, setStrategy] = useState<string>("")
  const [benchmark, setBenchmark] = useState<typeof BENCHMARK_OPTIONS[number]>(
    (defaults?.default_benchmark ?? "SPY") as typeof BENCHMARK_OPTIONS[number]
  )
  const [universe, setUniverse] = useState<UniverseId>(
    (defaults?.default_universe ?? "ETF8") as UniverseId
  )
  const [universeState, setUniverseState] = useState(initialUniverseState)
  const [batchStatus, setBatchStatus] = useState<UniverseBatchStatusSummary | null>(null)
  const [allowBatchPolling, setAllowBatchPolling] = useState(Boolean(initialUniverseState.batchId))
  const [isUniverseLoading, setIsUniverseLoading] = useState(false)
  const [isPreflighting, setIsPreflighting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dateAdjustmentMessage, setDateAdjustmentMessage] = useState<string | null>(null)
  const [blockResult, setBlockResult] = useState<RunPreflightResult | null>(null)
  const [warnResult, setWarnResult] = useState<RunPreflightResult | null>(null)

  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    const yearsBack = defaults?.default_date_range_years ?? 5
    if (initialMaxEndDate) {
      const candidate = parseLocalDate(initialMaxEndDate)
      candidate.setFullYear(candidate.getFullYear() - yearsBack)
      if (coverageMin && candidate < coverageMin) {
        return new Date(coverageMin)
      }
      if (initialMinStartDate && format(candidate, "yyyy-MM-dd") < initialMinStartDate) {
        return parseLocalDate(initialMinStartDate)
      }
      return candidate
    }
    return undefined
  })
  const [endDate, setEndDate] = useState<Date | undefined>(
    () => (initialMaxEndDate ? parseLocalDate(initialMaxEndDate) : undefined)
  )
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [applyCosts, setApplyCosts] = useState(defaults?.apply_costs_default ?? true)
  const [capitalDisplay, setCapitalDisplay] = useState(
    (defaults?.default_initial_capital ?? CAPITAL_DEFAULT).toLocaleString("en-US")
  )
  const [capitalValue, setCapitalValue] = useState(
    defaults?.default_initial_capital ?? CAPITAL_DEFAULT
  )
  const [topNValue, setTopNValue] = useState(() =>
    String(Math.min(defaults?.default_top_n ?? 5, UNIVERSE_SIZES[(defaults?.default_universe ?? "ETF8") as UniverseId] ?? 20))
  )

  const topNMax = UNIVERSE_SIZES[universe] ?? 20
  const minStartDateStr = resolveMinStartDate(
    universeState.constraints.universeEarliestStart,
    universeState.constraints.universeValidFrom,
  )
  const maxEndDateStr = universeState.constraints.dataCutoffDate ?? dataCoverage?.maxDateStr ?? null
  const startDateStr = startDate ? format(startDate, "yyyy-MM-dd") : null
  const endDateStr = endDate ? format(endDate, "yyyy-MM-dd") : null
  const effectiveStrategyStart = strategy
    ? computeStrategyEarliestStart(strategy as StrategyId, dataCoverage?.minDateStr ?? null)
    : null
  const showWarmupWarning =
    effectiveStrategyStart !== null &&
    startDateStr !== null &&
    startDateStr < effectiveStrategyStart
  const warmupDays = strategy ? STRATEGY_WARMUP_CALENDAR_DAYS[strategy as StrategyId] ?? 0 : 0
  const warmupDesc = strategy ? STRATEGY_WARMUP_DESCRIPTIONS[strategy as StrategyId] ?? "" : ""
  const hasMissingTickers = universeState.constraints.missingTickers.length > 0
  const isUniverseReady = universeState.ready && !hasMissingTickers
  const isQueueDisabled =
    !strategy ||
    isUniverseLoading ||
    isPreflighting ||
    isSubmitting ||
    !isUniverseReady

  useEffect(() => {
    const numericValue = Number(topNValue)
    if (!Number.isFinite(numericValue) || numericValue < 1) {
      setTopNValue(String(Math.min(defaults?.default_top_n ?? 5, topNMax)))
      return
    }
    if (numericValue > topNMax) {
      setTopNValue(String(topNMax))
    }
  }, [defaults?.default_top_n, topNMax, topNValue])

  async function loadUniverseState(universeId: UniverseId, options?: { createBatch?: boolean }) {
    setIsUniverseLoading(true)
    setSubmitError(null)
    setBatchStatus(null)
    lastLoadedUniverseRef.current = universeId
    try {
      const nextState = await ensureUniverseDataReady(universeId, options)
      setAllowBatchPolling(options?.createBatch !== false && Boolean(nextState.batchId))
      setUniverseState(nextState)
    } catch (error) {
      console.error("[RunForm] ensureUniverseDataReady failed:", error)
      setSubmitError("Failed to load universe data readiness. Please try again.")
    } finally {
      setIsUniverseLoading(false)
    }
  }

  useEffect(() => {
    if (universe === lastLoadedUniverseRef.current) return
    void loadUniverseState(universe, { createBatch: true })
  }, [universe])

  useEffect(() => {
    const batchId = universeState.batchId
    if (!batchId || universeState.ready || !allowBatchPolling) return
    const currentBatchId = batchId

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      const nextStatus = await getUniverseBatchStatusAction(currentBatchId)
      if (cancelled) return

      setBatchStatus(nextStatus)

      if (!nextStatus || (nextStatus.status !== "pending" && nextStatus.status !== "running")) {
        const refreshed = await ensureUniverseDataReady(universe, { createBatch: false })
        if (cancelled) return
        setAllowBatchPolling(false)
        setUniverseState(refreshed)
        return
      }

      timeoutId = setTimeout(poll, 2000)
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [allowBatchPolling, universe, universeState.batchId, universeState.ready])

  useEffect(() => {
    if (!startDateStr && !endDateStr) return

    let nextStart = startDate
    let nextEnd = endDate
    let snappedMessage: string | null = null

    if (minStartDateStr && startDateStr && startDateStr < minStartDateStr) {
      nextStart = parseLocalDate(minStartDateStr)
      snappedMessage = `Start date snapped to ${minStartDateStr} because some assets in ${universe} started later.`
    }

    if (maxEndDateStr && endDateStr && endDateStr > maxEndDateStr) {
      nextEnd = parseLocalDate(maxEndDateStr)
      snappedMessage = `End date snapped to ${maxEndDateStr} because backtests stop at the current data cutoff.`
    }

    const nextStartStr = nextStart ? format(nextStart, "yyyy-MM-dd") : null
    const nextEndStr = nextEnd ? format(nextEnd, "yyyy-MM-dd") : null
    if (nextStartStr && nextEndStr && nextStartStr > nextEndStr) {
      nextEnd = parseLocalDate(nextStartStr)
      snappedMessage = `End date snapped to ${nextStartStr} to keep the date range valid.`
    }

    if (nextStart !== startDate) setStartDate(nextStart)
    if (nextEnd !== endDate) setEndDate(nextEnd)
    if (snappedMessage) setDateAdjustmentMessage(snappedMessage)
  }, [endDate, endDateStr, maxEndDateStr, minStartDateStr, startDate, startDateStr, universe])

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

  function collectRunInput(): RunConfigInput | null {
    if (!formRef.current || !startDate || !endDate) return null
    const formData = new FormData(formRef.current)

    return {
      name: String(formData.get("name") ?? ""),
      strategy_id: String(formData.get("strategy_id") ?? "") as StrategyId,
      start_date: toInputDate(startDate),
      end_date: toInputDate(endDate),
      benchmark,
      universe,
      costs_bps: Number(formData.get("costs_bps") ?? 0),
      top_n: Number(topNValue ?? 1),
      initial_capital: capitalValue,
      apply_costs: applyCosts,
      slippage_bps: Number(formData.get("slippage_bps") ?? 0),
    }
  }

  async function runCreate(acknowledgeWarnings: boolean) {
    const input = collectRunInput()
    if (!input) {
      setSubmitError("Please complete the form before queueing a backtest.")
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const result = await createRun({
        ...input,
        acknowledge_warnings: acknowledgeWarnings,
      })
      if (result.ok) {
        router.push(`/runs/${result.runId}`)
        return
      }

      if (result.preflight?.status === "block") {
        setBlockResult(result.preflight)
      } else if (result.preflight?.status === "warn") {
        setWarnResult(result.preflight)
      } else {
        setSubmitError(result.error)
      }
    } catch (error) {
      console.error("[RunForm] createRun failed:", error)
      setSubmitError("Failed to queue the backtest. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)
    setDateAdjustmentMessage(null)

    const input = collectRunInput()
    if (!input) {
      setSubmitError("Please complete the form before queueing a backtest.")
      return
    }

    setIsPreflighting(true)
    try {
      const result = await preflightRun(input)
      if (result.status === "block") {
        setBlockResult(result)
        return
      }
      if (result.status === "warn") {
        setWarnResult(result)
        return
      }
      await runCreate(false)
    } catch (error) {
      console.error("[RunForm] preflightRun failed:", error)
      setSubmitError("Preflight failed. Please try again.")
    } finally {
      setIsPreflighting(false)
    }
  }

  async function applySuggestedFix(kind: string, value?: string | number | string[]) {
    if (kind === "clamp_start_date" && typeof value === "string") {
      setStartDate(parseLocalDate(value))
      setDateAdjustmentMessage(`We've moved your start date to ${value}.`)
      setBlockResult(null)
      setWarnResult(null)
      return
    }
    if (kind === "clamp_end_date" && typeof value === "string") {
      setEndDate(parseLocalDate(value))
      setDateAdjustmentMessage(`We've moved your end date to ${value}.`)
      setBlockResult(null)
      setWarnResult(null)
      return
    }
    if (kind === "set_top_n" && typeof value === "number") {
      setTopNValue(String(value))
      setDateAdjustmentMessage(`We've reduced Top N to ${value}.`)
      setBlockResult(null)
      setWarnResult(null)
      return
    }
    if (kind === "reduce_top_n" && typeof value === "number") {
      setTopNValue(String(value))
      setDateAdjustmentMessage(`We've reduced Top N to ${value}.`)
      setBlockResult(null)
      setWarnResult(null)
      return
    }
    if (kind === "change_benchmark" && typeof value === "string") {
      setBenchmark(value as typeof BENCHMARK_OPTIONS[number])
      setDateAdjustmentMessage(`We've switched the benchmark to ${value}.`)
      setBlockResult(null)
      setWarnResult(null)
      return
    }
    if (kind === "retry_repairs" && Array.isArray(value)) {
      setSubmitError(null)
      const input = collectRunInput()
      if (!input) return
      const result = await retryPreflightRepairs({
        symbols: value,
        required_end: blockResult?.requiredEnd ?? warnResult?.requiredEnd ?? input.end_date,
      })
      if (!result.ok) {
        setSubmitError(result.error)
        return
      }
      if (value.some((symbol) => universeState.constraints.missingTickers.includes(symbol))) {
        await loadUniverseState(universe, { createBatch: false })
      }
      setBlockResult(null)
      setWarnResult(null)
      setDateAdjustmentMessage("We restarted the data repair. Try queueing the run again once it finishes.")
    }
  }
  const blockIssues = (blockResult?.issues ?? []).filter((issue) => issue.severity === "blocked")
  const warnIssues = (warnResult?.issues ?? []).filter((issue) => issue.severity === "warning")

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
          <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="text-[12px] font-medium text-muted-foreground">
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

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground">
                Universe
              </Label>
              <NativeSelect
                name="universe"
                value={universe}
                onChange={(e) => setUniverse(e.target.value as UniverseId)}
                required
                hasValue
                className="h-8 border-border bg-secondary/40 pl-3 pr-8 text-[13px]"
              >
                {ALL_UNIVERSES.map((preset) => (
                  <option key={preset} value={preset} className="text-foreground">
                    {preset}
                  </option>
                ))}
              </NativeSelect>
              {minStartDateStr ? (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Earliest valid start for this universe:{" "}
                  <span className="font-mono text-foreground">{minStartDateStr}</span>{" "}
                  (because some assets started later).
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Earliest valid start will appear once every ticker in this universe is ingested.
                </p>
              )}
              {hasMissingTickers && (
                <p className="text-[11px] text-amber-300/90">
                  Missing tickers: {universeState.constraints.missingTickers.join(", ")}
                </p>
              )}
            </div>

            {!isUniverseReady && (
              <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-amber-950/30 border border-amber-800/40">
                <span className="text-amber-400 text-xs mt-0.5">!</span>
                <div className="space-y-1 text-xs text-amber-300/80 leading-snug">
                  {isUniverseLoading ? (
                    <p>Checking universe data readiness...</p>
                  ) : batchStatus && (batchStatus.status === "pending" || batchStatus.status === "running") ? (
                    <p>
                      Preparing missing universe data: {batchStatus.completedJobs}/{batchStatus.totalJobs} jobs complete
                      ({batchStatus.avgProgress}%).
                    </p>
                  ) : (
                    <p>
                      Queue Backtest stays disabled until the selected universe is fully ingested and ready.
                    </p>
                  )}
                  {!isUniverseLoading && !universeState.batchId && hasMissingTickers && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadUniverseState(universe, { createBatch: true })}
                      className="h-7 text-[11px] border-amber-700/50 bg-transparent text-amber-200 hover:bg-amber-950/40"
                    >
                      <RefreshCcw className="w-3 h-3 mr-1.5" />
                      Retry data repair
                    </Button>
                  )}
                </div>
              </div>
            )}

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
                <div>
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
                    <PopoverContent className="w-auto p-0" align="start">
                      <YearPickCalendar
                        startMonth={coverageMin ?? new Date(2015, 0)}
                        endMonth={maxEndDateStr ? parseLocalDate(maxEndDateStr) : new Date()}
                        selected={startDate}
                        onSelect={(d) => {
                          if (!d) return
                          const selectedStr = format(d, "yyyy-MM-dd")
                          if (minStartDateStr && selectedStr < minStartDateStr) {
                            setStartDate(parseLocalDate(minStartDateStr))
                            setDateAdjustmentMessage(`Start date snapped to ${minStartDateStr}.`)
                            setStartOpen(false)
                            return
                          }
                          if (maxEndDateStr && selectedStr > maxEndDateStr) return
                          setStartDate(d)
                          setStartOpen(false)
                        }}
                        disabled={(d) => {
                          const value = format(d, "yyyy-MM-dd")
                          if (minStartDateStr && value < minStartDateStr) return true
                          if (maxEndDateStr && value > maxEndDateStr) return true
                          if (endDateStr && value > endDateStr) return true
                          return false
                        }}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
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
                    <PopoverContent className="w-auto p-0" align="start">
                      <YearPickCalendar
                        startMonth={coverageMin ?? new Date(2015, 0)}
                        endMonth={maxEndDateStr ? parseLocalDate(maxEndDateStr) : new Date()}
                        selected={endDate}
                        onSelect={(d) => {
                          if (!d) return
                          const selectedStr = format(d, "yyyy-MM-dd")
                          if (startDateStr && selectedStr < startDateStr) {
                            setEndDate(parseLocalDate(startDateStr))
                            setDateAdjustmentMessage(`End date snapped to ${startDateStr}.`)
                            setEndOpen(false)
                            return
                          }
                          if (maxEndDateStr && selectedStr > maxEndDateStr) {
                            setEndDate(parseLocalDate(maxEndDateStr))
                            setDateAdjustmentMessage(`End date snapped to ${maxEndDateStr}.`)
                            setEndOpen(false)
                            return
                          }
                          setEndDate(d)
                          setEndOpen(false)
                        }}
                        disabled={(d) => {
                          const value = format(d, "yyyy-MM-dd")
                          if (startDateStr && value < startDateStr) return true
                          if (maxEndDateStr && value > maxEndDateStr) return true
                          return false
                        }}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="space-y-0.5">
                {maxEndDateStr && (
                  <p className="text-[11px] text-muted-foreground">
                    Data current through{" "}
                    <span className="font-mono font-medium text-foreground">{maxEndDateStr}</span>{" "}
                    <span className="text-emerald-400">(Backtest-ready)</span>.
                  </p>
                )}
                {dataCoverage?.minDateStr && (
                  <p className="text-[11px] text-muted-foreground">
                    Earliest visible history: {dataCoverage.minDateStr}
                  </p>
                )}
              </div>
            </div>

            {showWarmupWarning && effectiveStrategyStart && (
              <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-amber-950/30 border border-amber-800/40">
                <span className="text-amber-400 text-xs mt-0.5">!</span>
                <p className="text-xs text-amber-300/80 leading-snug">
                  <strong>{STRATEGY_LABELS[strategy as StrategyId]}</strong> needs ~{warmupDays}{" "}
                  calendar days of history before it can trade.{warmupDesc ? ` ${warmupDesc}` : ""}{" "}
                  Earliest recommended start:{" "}
                  <span className="font-mono">{effectiveStrategyStart}</span>.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="initial_capital" className="text-[12px] font-medium text-muted-foreground">
                Initial Capital ($)
              </Label>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="benchmark" className="text-[12px] font-medium text-muted-foreground">
                  Benchmark
                </Label>
                <NativeSelect
                  id="benchmark"
                  name="benchmark"
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value as typeof BENCHMARK_OPTIONS[number])}
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
                <Label htmlFor="costs_bps" className="text-[12px] font-medium text-muted-foreground">
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
                <Label htmlFor="top_n" className="text-[12px] font-medium text-muted-foreground">
                  Top N
                </Label>
                <Input
                  id="top_n"
                  name="top_n"
                  type="number"
                  min={1}
                  max={topNMax}
                  step={1}
                  value={topNValue}
                  onChange={(e) => setTopNValue(e.target.value)}
                  className="h-8 text-[13px] bg-secondary/40 border-border"
                  required
                />
                <span className="text-[11px] text-muted-foreground">Max {topNMax} for {universe}</span>
              </div>
            </div>

            <Separator className="my-1 bg-border/50" />

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
              <Switch
                id="apply_costs_toggle"
                checked={applyCosts}
                onCheckedChange={setApplyCosts}
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slippage_bps" className="text-[12px] font-medium text-muted-foreground">
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

            {dateAdjustmentMessage && (
              <p className="text-[12px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-md px-3 py-2">
                {dateAdjustmentMessage}
              </p>
            )}

            {submitError && (
              <p className="text-[12px] text-destructive bg-destructive/8 border border-destructive/20 rounded-md px-3 py-2">
                {submitError}
              </p>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={isQueueDisabled}
              className="h-8 text-[12px] font-medium mt-1 w-full"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {isSubmitting ? "Queueing..." : isPreflighting ? "Checking..." : "Queue Backtest"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={blockResult !== null} onOpenChange={(open) => !open && setBlockResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This run is blocked</AlertDialogTitle>
            <AlertDialogDescription>
              Fix these items before the run can be created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            {blockIssues.map((issue) => {
              const action = issue.action
              return (
                <div key={`${issue.code}:${issue.reason}`} className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2.5">
                  <p className="text-sm text-foreground">{issue.reason}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{issue.fix}</p>
                  {action && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void applySuggestedFix(action.kind, action.value)}
                      >
                        {action.label}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {diagnostics && blockResult && <PreflightBenchmarkDiagnostics result={blockResult} />}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={warnResult !== null} onOpenChange={(open) => !open && setWarnResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warning</DialogTitle>
            <DialogDescription>
              Review these warnings before you continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {warnIssues.map((issue) => {
              const action = issue.action
              return (
                <div key={`${issue.code}:${issue.reason}`} className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2.5">
                  <p className="text-sm text-foreground">{issue.reason}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{issue.fix}</p>
                  {action && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void applySuggestedFix(action.kind, action.value)}
                      >
                        {action.label}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {diagnostics && warnResult && <PreflightBenchmarkDiagnostics result={warnResult} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWarnResult(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setWarnResult(null)
                void runCreate(true)
              }}
            >
              Acknowledge and Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
