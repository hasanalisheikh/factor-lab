import Link from "next/link";

import { Activity, AlertCircle, AlertTriangle, Info, XCircle, CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatISODate } from "@/lib/utils/dates";

import type { DataHealthAssessment, HealthStatus } from "@/lib/data-health";
import type { ScheduledRefreshActivity } from "@/lib/supabase/queries";

function healthVerdict(status: HealthStatus) {
  if (status === "NO_DATA") {
    return {
      label: "No Data",
      Icon: XCircle,
      textCls: "text-muted-foreground",
      borderCls: "border-border",
    };
  }
  if (status === "GOOD") {
    return {
      label: "Good",
      Icon: CheckCircle2,
      textCls: "text-emerald-400",
      borderCls: "border-emerald-800/40",
    };
  }
  if (status === "WARNING") {
    return {
      label: "Warning",
      Icon: AlertCircle,
      textCls: "text-amber-400",
      borderCls: "border-amber-800/40",
    };
  }
  return {
    label: "Blocked",
    Icon: XCircle,
    textCls: "text-red-400",
    borderCls: "border-red-800/40",
  };
}

export function ScheduledRefreshBanner({
  refreshTotals,
  scheduledActivity,
}: {
  refreshTotals: number;
  scheduledActivity: ScheduledRefreshActivity;
}) {
  if (refreshTotals <= 0) {
    return null;
  }

  return (
    <Card className="mb-3 border-blue-800/40 bg-blue-950/30">
      <CardContent className="flex items-start gap-3 py-4">
        <Activity className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
        <div>
          <p className="text-foreground text-sm font-semibold">Scheduled data refresh running</p>
          <p className="mt-0.5 text-xs text-blue-300/90">
            Monthly: {scheduledActivity.monthlyActiveJobs} job
            {scheduledActivity.monthlyActiveJobs !== 1 ? "s" : ""}
            {" · "}
            Daily patch: {scheduledActivity.dailyActiveJobs} job
            {scheduledActivity.dailyActiveJobs !== 1 ? "s" : ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function DiagnosticsModeToggle({
  showInternalDiagnostics,
  mode,
  buildDataHref,
}: {
  showInternalDiagnostics: boolean;
  mode: "backtest" | "full";
  buildDataHref: (nextMode: "backtest" | "full") => string;
}) {
  if (!showInternalDiagnostics) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="border-border bg-muted/40 flex w-fit items-center gap-1 rounded-lg border p-1">
        <Link
          href={buildDataHref("backtest")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "backtest"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Backtest-ready
        </Link>
        <Link
          href={buildDataHref("full")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "full"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Advanced
        </Link>
      </div>
    </div>
  );
}

export function DataModeDescription({
  mode,
  backtestReadyWindowHealthy,
  currentThrough,
}: {
  mode: "backtest" | "full";
  backtestReadyWindowHealthy: boolean;
  currentThrough: string | null;
}) {
  return (
    <div className="mb-4">
      <p className="text-muted-foreground text-xs">
        {mode === "backtest" ? (
          backtestReadyWindowHealthy ? (
            <>
              Backtest-ready: required tickers are fully covered in the research window through{" "}
              <span className="font-mono font-semibold text-emerald-400">
                {formatISODate(currentThrough)}
              </span>
              .
            </>
          ) : (
            <>
              Backtest-ready tracks required tickers inside the research window through{" "}
              <span className="text-foreground font-mono">{formatISODate(currentThrough)}</span>.
            </>
          )
        ) : (
          <>
            Advanced expands into DB-wide coverage, benchmark repair state, and recent ingestion
            jobs while keeping the same global cutoff at{" "}
            <span className="text-foreground font-mono">{formatISODate(currentThrough)}</span>.
          </>
        )}
      </p>
    </div>
  );
}

export function AdvancedDiagnosticsNotice({
  mode,
  diagnostics,
}: {
  mode: "backtest" | "full";
  diagnostics: boolean;
}) {
  if (mode !== "full") {
    return null;
  }

  return (
    <div className="border-border bg-muted/40 mb-4 rounded-lg border px-4 py-3">
      <div className="flex gap-2">
        <Info className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="text-muted-foreground space-y-1.5 text-xs">
          <p>
            Advanced diagnostics includes DB-wide earliest coverage, pre-inception counts, benchmark
            repair state, and recent ingestion job outcomes.
          </p>
          <p>
            Diagnostics is {diagnostics ? "enabled" : "off"}.
            {diagnostics
              ? " Repair controls and raw error messages are visible."
              : " Repair controls stay hidden until you opt in."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DataHealthCard({
  healthAssessment,
  mode,
}: {
  healthAssessment: DataHealthAssessment;
  mode: "backtest" | "full";
}) {
  const verdict = healthVerdict(healthAssessment.status);
  const { Icon: VerdictIcon } = verdict;

  return (
    <Card className={`bg-card mb-4 border ${verdict.borderCls}`}>
      <CardContent className="flex items-start gap-3 py-4">
        <VerdictIcon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${verdict.textCls}`} />
        <div>
          <p className="text-foreground text-sm font-semibold">
            Data Health: <span className={verdict.textCls}>{verdict.label}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {healthAssessment.reason}
            {mode === "full" &&
              " Health is still scored on the required backtest research window; the panels below add deeper diagnostics."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RequiredTickersMissingAlert({
  tickers,
  mode,
  showInternalDiagnostics,
}: {
  tickers: string[];
  mode: "backtest" | "full";
  showInternalDiagnostics: boolean;
}) {
  if (tickers.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 mb-4 flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
      <p className="text-xs text-amber-300/80">
        <strong>
          {mode === "backtest"
            ? "Missing from the required dataset:"
            : "Required tickers still missing:"}
        </strong>{" "}
        <span className="font-mono">{tickers.join(", ")}</span>.
        {mode === "backtest"
          ? showInternalDiagnostics
            ? " Repairs run in the background and can be inspected in Advanced."
            : " Repairs run in the background automatically."
          : " Scheduled jobs will repair these automatically; diagnostics exposes the raw job state."}
      </p>
    </div>
  );
}

export function InceptionAwareCoverageNote({
  showInternalDiagnostics,
}: {
  showInternalDiagnostics: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="flex items-start gap-3 py-4">
        <Info className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <p className="text-foreground mb-1 text-xs font-semibold">Inception-aware coverage</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {showInternalDiagnostics
              ? "FactorLab keeps the visible dataset capped at a global cutoff date. Backtest-ready measures only the required ticker set inside each universe's research window. Advanced keeps the same cutoff but expands into DB-wide historical diagnostics, benchmark repair state, and recent job outcomes."
              : "FactorLab keeps the visible dataset capped at a global cutoff date. This page focuses on backtest-ready coverage for the required ticker set inside each universe's research window."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
