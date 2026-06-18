import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock3,
  Database,
  History,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { BenchmarkCoverageCard } from "@/components/data/benchmark-coverage-card";
import { TopMissingTable } from "@/components/data/top-missing-table";
import { UniverseTierSummary } from "@/components/data/universe-tier-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DAILY_PATCH_RUN_HOUR_UTC } from "@/lib/data-cutoff";
import { formatISODate, formatISOTimestamp } from "@/lib/utils/dates";
import { HistoryCard } from "./history-card";
import { RequiredTickersMissingAlert } from "./data-page-notices";
import { SummaryMetricCard } from "./summary-metric-card";

import type { BenchmarkRowData } from "@/components/data/benchmark-coverage-card";
import type { DataHealthAssessment, InceptionAwareCoverageSummary } from "@/lib/data-health";
import type {
  DataHealthSummary,
  DataIngestJobHistoryEntry,
  DataStateSummary,
  RequiredTickerResearchSummary,
} from "@/lib/supabase/queries";
import type { BenchmarkCoverage, TickerDateRange, TickerMissingnessV2 } from "@/lib/supabase/types";

export type ScheduleStatus = {
  label: string;
  cls: string;
};

export type BenchmarkRepairStatus = {
  available: boolean;
  issues: BenchmarkCoverage[];
  label: string;
  cls: string;
};

type SharedPanelProps = {
  currentThrough: string | null;
  dataState: DataStateSummary;
  monthlyStatus: ScheduleStatus;
  dailyStatus: ScheduleStatus;
  dailyShowNoopHint: boolean;
  dailyNoopCheckAt: string | null;
  tickerRanges: TickerDateRange[];
  universeNotIngested: string[];
  showInternalDiagnostics: boolean;
};

type BacktestModePanelProps = SharedPanelProps & {
  requiredResearch: RequiredTickerResearchSummary;
  healthAssessment: DataHealthAssessment;
  benchmarkStatus: BenchmarkRepairStatus;
  backtestTopIssues: TickerMissingnessV2[];
};

type AdvancedModePanelProps = SharedPanelProps & {
  health: DataHealthSummary;
  requiredResearch: RequiredTickerResearchSummary;
  advancedDiagnostics: InceptionAwareCoverageSummary | null;
  advancedMissingRows: TickerMissingnessV2[];
  benchmarkRows: BenchmarkRowData[] | null;
  jobHistory: DataIngestJobHistoryEntry[];
  diagnostics: boolean;
};

export function BacktestModePanel({
  requiredResearch,
  healthAssessment,
  currentThrough,
  dataState,
  monthlyStatus,
  dailyStatus,
  dailyShowNoopHint,
  dailyNoopCheckAt,
  benchmarkStatus,
  tickerRanges,
  universeNotIngested,
  showInternalDiagnostics,
  backtestTopIssues,
}: BacktestModePanelProps) {
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetricCard
          title="Tickers Ingested"
          tooltip="Required universe + benchmark tickers currently present in the monitored research window."
          value={`${requiredResearch.ingestedTickers} / ${requiredResearch.requiredTickers.length}`}
          meta="Required set only"
          icon={<Database className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Current Through"
          tooltip="The global data cutoff used for backtests and coverage checks."
          value={formatISODate(currentThrough)}
          meta="Last complete trading day"
          valueClassName="font-mono text-lg font-semibold text-foreground"
          icon={<Calendar className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Completeness"
          tooltip="Actual rows divided by expected research-window trading days for required tickers only."
          value={
            requiredResearch.completeness !== null
              ? `${requiredResearch.completeness.toFixed(1)}%`
              : "—"
          }
          meta={`${requiredResearch.totalActual.toLocaleString()} / ${requiredResearch.totalExpected.toLocaleString()} monitored rows`}
          valueClassName={`text-2xl font-semibold ${
            healthAssessment.status === "GOOD"
              ? "text-emerald-400"
              : healthAssessment.status === "WARNING"
                ? "text-amber-400"
                : healthAssessment.status === "DEGRADED"
                  ? "text-red-400"
                  : "text-muted-foreground"
          }`}
          icon={<ShieldCheck className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="True Missing"
          tooltip="Missing trading days inside the required research window. Pre-inception history is excluded."
          value={requiredResearch.totalTrueMissing.toLocaleString()}
          meta={
            requiredResearch.totalTrueMissing > 0
              ? "Gaps that can affect backtests"
              : "No true gaps detected"
          }
          valueClassName={`text-2xl font-semibold ${
            requiredResearch.totalTrueMissing > 0 ? "text-amber-400" : "text-emerald-400"
          }`}
          icon={<AlertTriangle className="text-muted-foreground h-5 w-5" />}
        />
      </div>

      <Card className="border-border bg-card mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground text-sm font-semibold">Data Cutoff Mode</CardTitle>
          <p className="text-muted-foreground text-xs">
            Backtest-ready stays pinned to the cutoff and does not expose manual repair controls.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="border-border/60 bg-muted/20 rounded-md border px-3 py-2">
            <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
              Update Schedule
            </p>
            <p className="text-foreground mt-1 text-sm font-semibold">Monthly</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              next run:{" "}
              <span className="text-foreground font-mono">{dataState.nextMonthlyRefresh}</span> UTC
            </p>
            <p className={`mt-0.5 text-xs ${monthlyStatus.cls}`}>Status: {monthlyStatus.label}</p>
          </div>
          <div className="border-border/60 bg-muted/20 rounded-md border px-3 py-2">
            <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Daily Patch</p>
            <p
              className={`mt-1 text-sm font-semibold ${dataState.dailyUpdatesEnabled ? "text-emerald-400" : "text-muted-foreground"}`}
            >
              {dataState.dailyUpdatesEnabled ? "Enabled" : "Disabled"}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {dataState.dailyUpdatesEnabled
                ? `Scheduled at ${String(DAILY_PATCH_RUN_HOUR_UTC).padStart(2, "0")}:00 UTC`
                : "Daily patch: Disabled"}
            </p>
            <p className={`mt-0.5 text-xs ${dailyStatus.cls}`}>Status: {dailyStatus.label}</p>
            {dailyShowNoopHint && (
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Checked {formatISOTimestamp(dailyNoopCheckAt!)} · No update needed
              </p>
            )}
          </div>
          <div className="border-border/60 bg-muted/20 rounded-md border px-3 py-2">
            <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Benchmarks</p>
            <p className={`mt-1 text-sm font-semibold ${benchmarkStatus.cls}`}>
              {benchmarkStatus.label}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {!benchmarkStatus.available
                ? "Benchmark coverage is temporarily unavailable."
                : benchmarkStatus.issues.length === 0
                  ? "All supported benchmarks are healthy inside the research window."
                  : showInternalDiagnostics
                    ? `${benchmarkStatus.issues.length} benchmark${benchmarkStatus.issues.length !== 1 ? "s" : ""} still need repair. Details live in Advanced.`
                    : `${benchmarkStatus.issues.length} benchmark${benchmarkStatus.issues.length !== 1 ? "s" : ""} still need repair. Automatic repairs continue in the background.`}
            </p>
          </div>
        </CardContent>
      </Card>

      <UniverseTierSummary
        ranges={tickerRanges}
        notIngested={universeNotIngested}
        mode="backtest"
      />

      <RequiredTickersMissingAlert
        tickers={requiredResearch.notIngestedTickers}
        mode="backtest"
        showInternalDiagnostics={showInternalDiagnostics}
      />

      <Card className="border-border bg-card mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground text-sm font-semibold">Top Issues</CardTitle>
          <p className="text-muted-foreground text-xs">
            The 10 required tickers with the most true missing days inside the research window.
          </p>
        </CardHeader>
        <CardContent>
          <TopMissingTable
            rows={backtestTopIssues}
            initialRows={10}
            allowExpand={false}
            showPreInception={false}
            firstDateLabel="Research Start"
            emptyMessage="No required-ticker gaps detected inside the monitored research window."
          />
        </CardContent>
      </Card>
    </>
  );
}

export function AdvancedModePanel({
  health,
  currentThrough,
  dataState,
  monthlyStatus,
  dailyStatus,
  dailyShowNoopHint,
  dailyNoopCheckAt,
  advancedDiagnostics,
  tickerRanges,
  universeNotIngested,
  requiredResearch,
  advancedMissingRows,
  benchmarkRows,
  jobHistory,
  diagnostics,
}: AdvancedModePanelProps) {
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryMetricCard
          title="DB Tickers"
          tooltip="Distinct tickers with price data anywhere in the database."
          value={health.tickersCount > 0 ? health.tickersCount : "—"}
          icon={<Database className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Earliest Coverage"
          tooltip="The earliest date visible in the database-wide diagnostic view."
          value={formatISODate(health.dateStart)}
          valueClassName="font-mono text-lg font-semibold text-foreground"
          icon={<Clock3 className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Current Through"
          tooltip="The fixed data cutoff shared by diagnostics and backtests."
          value={formatISODate(currentThrough)}
          valueClassName="font-mono text-lg font-semibold text-foreground"
          icon={<Calendar className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Update Schedule"
          tooltip="Scheduled refresh cadence for required tickers."
          value="Monthly"
          meta={
            <>
              next run:{" "}
              <span className="text-foreground font-mono">{dataState.nextMonthlyRefresh}</span> UTC
              <br />
              <span className={monthlyStatus.cls}>Status: {monthlyStatus.label}</span>
            </>
          }
          valueClassName="text-lg font-semibold text-foreground"
          icon={<Activity className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Daily Patch"
          tooltip="Short rolling repair pass for required tickers only."
          value={dataState.dailyUpdatesEnabled ? "Enabled" : "Disabled"}
          meta={
            <>
              {dataState.dailyUpdatesEnabled
                ? `Scheduled at ${String(DAILY_PATCH_RUN_HOUR_UTC).padStart(2, "0")}:00 UTC`
                : "Daily patch: Disabled"}
              <br />
              <span className={dailyStatus.cls}>Status: {dailyStatus.label}</span>
              {dailyShowNoopHint && (
                <>
                  <br />
                  <span>Checked {formatISOTimestamp(dailyNoopCheckAt!)} · No update needed</span>
                </>
              )}
            </>
          }
          valueClassName={`text-lg font-semibold ${dataState.dailyUpdatesEnabled ? "text-emerald-400" : "text-muted-foreground"}`}
          icon={<Wrench className="text-muted-foreground h-5 w-5" />}
        />
        <SummaryMetricCard
          title="Pre-Inception"
          tooltip="DB-wide pre-inception days excluded from missingness calculations."
          value={advancedDiagnostics?.totalPreInception.toLocaleString() ?? "—"}
          icon={<History className="text-muted-foreground h-5 w-5" />}
        />
      </div>

      <UniverseTierSummary ranges={tickerRanges} notIngested={universeNotIngested} mode="full" />

      <RequiredTickersMissingAlert
        tickers={requiredResearch.notIngestedTickers}
        mode="full"
        showInternalDiagnostics
      />

      <div className="mb-4 grid gap-4 md:grid-cols-7">
        <Card className="bg-card border-border md:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground text-sm font-semibold">
              Tickers with True Gaps
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              DB-wide true missing days within each ticker&apos;s own window through the current
              cutoff. Pre-inception history is shown separately.
            </p>
            <p className="text-muted-foreground text-xs">
              These are historical gaps since inception and may not affect backtests in the research
              window.
            </p>
          </CardHeader>
          <CardContent>
            <TopMissingTable rows={advancedMissingRows} initialRows={20} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 md:col-span-3">
          <BenchmarkCoverageCard
            benchmarks={benchmarkRows}
            isDev={process.env.NODE_ENV !== "production"}
          />
          <HistoryCard rows={jobHistory} diagnostics={diagnostics} />
        </div>
      </div>
    </>
  );
}
