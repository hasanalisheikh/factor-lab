"use client";

import type { KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { RunActionsMenu } from "@/components/run-actions-menu";
import { cn } from "@/lib/utils";
import { formatDrawdown } from "@/lib/format";
import type { RunMetricsRow, RunWithMetrics } from "@/lib/supabase/types";
import { STRATEGY_LABELS, type StrategyId, type RunStatus } from "@/lib/types";

type DesktopSortKey =
  | "name"
  | "strategy_id"
  | "status"
  | "cagr"
  | "sharpe"
  | "max_drawdown"
  | "start_date";

type SortableKey = DesktopSortKey | "created_at";
type SortDirection = "asc" | "desc";
type MobileSortKey = "name" | "cagr" | "created_at" | "status";

const MOBILE_SORT_OPTIONS: Array<{
  value: MobileSortKey;
  label: string;
  direction: SortDirection;
}> = [
  { value: "created_at", label: "Created", direction: "desc" },
  { value: "name", label: "Name", direction: "asc" },
  { value: "cagr", label: "CAGR", direction: "desc" },
  { value: "status", label: "Status", direction: "asc" },
];

function SortHeader({
  label,
  sort,
  onToggle,
}: {
  label: string;
  sort: DesktopSortKey;
  onToggle: (k: DesktopSortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sort)}
      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

function getMetrics(value: RunMetricsRow[] | RunMetricsRow | null): RunMetricsRow | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function sortRuns(runs: RunWithMetrics[], sortKey: SortableKey, sortDir: SortDirection) {
  const sorted = [...runs];
  sorted.sort((a, b) => {
    const am = getMetrics(a.run_metrics);
    const bm = getMetrics(b.run_metrics);
    let cmp = 0;

    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "strategy_id":
        cmp = a.strategy_id.localeCompare(b.strategy_id);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "start_date":
        cmp = String(a.start_date ?? "").localeCompare(String(b.start_date ?? ""));
        break;
      case "created_at":
        cmp = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
        break;
      case "cagr":
        cmp = (am?.cagr ?? Number.NEGATIVE_INFINITY) - (bm?.cagr ?? Number.NEGATIVE_INFINITY);
        break;
      case "sharpe":
        cmp = (am?.sharpe ?? Number.NEGATIVE_INFINITY) - (bm?.sharpe ?? Number.NEGATIVE_INFINITY);
        break;
      case "max_drawdown":
        cmp =
          Math.abs(am?.max_drawdown ?? Number.POSITIVE_INFINITY) -
          Math.abs(bm?.max_drawdown ?? Number.POSITIVE_INFINITY);
        break;
    }

    return sortDir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function MetricChip({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="border-border/60 bg-secondary/20 rounded-lg border px-2.5 py-2">
      <div className="text-muted-foreground text-[10px] font-medium tracking-[0.12em] uppercase">
        {label}
      </div>
      <div className={cn("text-card-foreground mt-1 font-mono text-[13px]", valueClassName)}>
        {value}
      </div>
    </div>
  );
}

interface RunsTableProps {
  runs: RunWithMetrics[];
  searchQuery?: string;
  /** runId → progress % (0-100) for active runs. Populated by the server page. */
  progressMap?: Record<string, number>;
  /** runId → report URL for runs with a generated report. */
  reportUrls?: Record<string, string>;
}

export function RunsTable({
  runs,
  searchQuery,
  progressMap = {},
  reportUrls = {},
}: RunsTableProps) {
  const router = useRouter();
  const [desktopSortKey, setDesktopSortKey] = useState<DesktopSortKey>("start_date");
  const [desktopSortDir, setDesktopSortDir] = useState<SortDirection>("desc");
  const [mobileSortKey, setMobileSortKey] = useState<MobileSortKey>("created_at");

  const desktopSortedRuns = useMemo(
    () => sortRuns(runs, desktopSortKey, desktopSortDir),
    [desktopSortDir, desktopSortKey, runs]
  );

  const mobileSortedRuns = useMemo(() => {
    const selectedSort =
      MOBILE_SORT_OPTIONS.find((option) => option.value === mobileSortKey) ??
      MOBILE_SORT_OPTIONS[0];
    return sortRuns(runs, selectedSort.value, selectedSort.direction);
  }, [mobileSortKey, runs]);

  const toggleSort = (key: DesktopSortKey) => {
    if (desktopSortKey === key) {
      setDesktopSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setDesktopSortKey(key);
    setDesktopSortDir("asc");
  };

  const openRun = (runId: string) => {
    router.push(`/runs/${runId}`);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, runId: string) => {
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRun(runId);
  };

  return (
    <Card className="border-border bg-card md:overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-card-foreground text-[13px] font-medium">All Runs</CardTitle>
      </CardHeader>

      <CardContent className="px-4 pt-0 pb-4 md:hidden">
        <div className="mb-3 flex items-center justify-end">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-[11px] font-medium">Sort</span>
            <Select
              value={mobileSortKey}
              onValueChange={(value) => setMobileSortKey(value as MobileSortKey)}
            >
              <SelectTrigger
                size="sm"
                className="border-border bg-secondary/40 h-8 w-[132px] text-[12px]"
                aria-label="Sort runs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOBILE_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {mobileSortedRuns.length === 0 ? (
          <div className="border-border/70 text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-[12px]">
            {searchQuery ? `No runs found for "${searchQuery}"` : "No runs found"}
          </div>
        ) : (
          <div className="space-y-3">
            {mobileSortedRuns.map((run) => {
              const metrics = getMetrics(run.run_metrics);
              const status = run.status as RunStatus;
              const hasMetrics =
                metrics !== null && (status === "completed" || status === "failed");
              const activeProgress =
                status === "running" || status === "waiting_for_data"
                  ? (progressMap[run.id] ?? null)
                  : null;
              const strategyLabel =
                STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id;
              const universeLabel =
                typeof run.universe === "string" && run.universe.trim().length > 0
                  ? run.universe
                  : null;

              return (
                <article
                  key={run.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openRun(run.id)}
                  onKeyDown={(event) => handleCardKeyDown(event, run.id)}
                  className="border-border bg-secondary/10 hover:bg-accent/20 focus-visible:ring-ring/50 cursor-pointer rounded-xl border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  aria-label={`Open run ${run.name}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <h3 className="text-card-foreground min-w-0 flex-1 truncate text-[13px] font-medium">
                          {run.name}
                        </h3>
                        <StatusBadge status={status} />
                      </div>

                      <p className="text-muted-foreground mt-1 truncate text-[12px]">
                        {strategyLabel}
                        {universeLabel ? ` · ${universeLabel}` : ""}
                      </p>

                      {activeProgress !== null ? (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="bg-secondary h-1.5 flex-1 rounded-full">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                status === "waiting_for_data" ? "bg-blue-500" : "bg-warning"
                              )}
                              style={{ width: `${activeProgress}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                            {activeProgress}%
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="-mt-1 -mr-1 shrink-0">
                      <RunActionsMenu
                        runId={run.id}
                        runName={run.name}
                        status={status}
                        reportUrl={reportUrls[run.id]}
                        showReportAction
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MetricChip
                      label="CAGR"
                      value={
                        hasMetrics
                          ? `${metrics.cagr >= 0 ? "+" : ""}${(metrics.cagr * 100).toFixed(1)}%`
                          : "--"
                      }
                      valueClassName={
                        !hasMetrics
                          ? "text-muted-foreground"
                          : metrics.cagr >= 0
                            ? "text-success"
                            : "text-destructive"
                      }
                    />
                    <MetricChip
                      label="Sharpe"
                      value={hasMetrics ? metrics.sharpe.toFixed(2) : "--"}
                      valueClassName={!hasMetrics ? "text-muted-foreground" : undefined}
                    />
                    <MetricChip
                      label="Max DD"
                      value={hasMetrics ? formatDrawdown(metrics.max_drawdown) : "--"}
                      valueClassName={!hasMetrics ? "text-muted-foreground" : "text-destructive"}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>

      <CardContent className="hidden px-0 pb-1 md:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px] table-fixed">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground pl-4 text-[11px] font-medium">
                  <SortHeader label="Name" sort="name" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground hidden w-[150px] text-[11px] font-medium md:table-cell">
                  <SortHeader label="Strategy" sort="strategy_id" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground w-[90px] text-[11px] font-medium">
                  <SortHeader label="Status" sort="status" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground w-[72px] text-right text-[11px] font-medium">
                  <SortHeader label="CAGR" sort="cagr" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground hidden w-[72px] text-right text-[11px] font-medium sm:table-cell">
                  <SortHeader label="Sharpe" sort="sharpe" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground hidden w-[72px] text-right text-[11px] font-medium lg:table-cell">
                  <SortHeader label="Max DD" sort="max_drawdown" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground hidden w-[164px] pr-4 text-[11px] font-medium lg:table-cell">
                  <SortHeader label="Period" sort="start_date" onToggle={toggleSort} />
                </TableHead>
                <TableHead className="text-muted-foreground w-[72px] pr-4 text-right text-[11px] font-medium">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {desktopSortedRuns.map((run) => {
                const metrics = getMetrics(run.run_metrics);
                const status = run.status as RunStatus;
                const hasMetrics =
                  metrics !== null && (status === "completed" || status === "failed");
                const activeProgress =
                  status === "running" || status === "waiting_for_data"
                    ? (progressMap[run.id] ?? null)
                    : null;
                const startPeriod = run.start_date ? run.start_date.slice(0, 7) : "--";
                const endPeriod = run.end_date ? run.end_date.slice(0, 7) : "--";

                return (
                  <TableRow
                    key={run.id}
                    className="border-border/40 hover:bg-accent/30 cursor-pointer"
                  >
                    <TableCell className="max-w-0 overflow-hidden py-2.5 pl-4">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-card-foreground hover:text-primary block truncate text-[13px] font-medium transition-colors"
                      >
                        {run.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden truncate py-2.5 text-[12px] md:table-cell">
                      {STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <StatusBadge status={status} />
                      {activeProgress !== null && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="bg-secondary h-1 w-12 overflow-hidden rounded-full">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                status === "waiting_for_data" ? "bg-blue-500" : "bg-warning"
                              )}
                              style={{ width: `${activeProgress}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                            {activeProgress}%
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-right font-mono text-[13px]",
                        !hasMetrics
                          ? "text-muted-foreground"
                          : metrics.cagr >= 0
                            ? "text-success"
                            : "text-destructive"
                      )}
                    >
                      {hasMetrics
                        ? `${metrics.cagr >= 0 ? "+" : ""}${(metrics.cagr * 100).toFixed(1)}%`
                        : "--"}
                    </TableCell>
                    <TableCell className="text-card-foreground hidden py-2.5 text-right font-mono text-[13px] sm:table-cell">
                      {hasMetrics ? metrics.sharpe.toFixed(2) : "--"}
                    </TableCell>
                    <TableCell className="text-destructive hidden py-2.5 text-right font-mono text-[13px] lg:table-cell">
                      {hasMetrics ? formatDrawdown(metrics.max_drawdown) : "--"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden py-2.5 pr-4 font-mono text-[12px] lg:table-cell">
                      {startPeriod} – {endPeriod}
                    </TableCell>
                    <TableCell className="py-2.5 pr-4 text-right">
                      <RunActionsMenu runId={run.id} runName={run.name} status={status} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-muted-foreground py-10 text-center text-[12px]"
                  >
                    {searchQuery ? `No runs found for "${searchQuery}"` : "No runs found"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
