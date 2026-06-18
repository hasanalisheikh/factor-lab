import { CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RunActionsMenu } from "@/components/run-actions-menu";
import { StatusBadge } from "@/components/status-badge";
import { formatDrawdown } from "@/lib/format";
import type { RunWithMetrics } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { STRATEGY_LABELS, type RunStatus, type StrategyId } from "@/lib/types";

import { getMetrics, MOBILE_SORT_OPTIONS } from "./table-helpers";
import { MetricChip } from "./metric-chip";
import type { HandleRunCardKeyDown, MobileSortKey } from "./types";

type MobileRunsListProps = {
  runs: RunWithMetrics[];
  searchQuery?: string;
  mobileSortKey: MobileSortKey;
  progressMap: Record<string, number>;
  reportUrls: Record<string, string>;
  onMobileSortChange: (value: MobileSortKey) => void;
  onOpenRun: (runId: string) => void;
  onCardKeyDown: HandleRunCardKeyDown;
};

export function MobileRunsList({
  runs,
  searchQuery,
  mobileSortKey,
  progressMap,
  reportUrls,
  onMobileSortChange,
  onOpenRun,
  onCardKeyDown,
}: MobileRunsListProps) {
  return (
    <CardContent className="px-4 pt-0 pb-4 md:hidden">
      <div className="mb-3 flex items-center justify-end">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[11px] font-medium">Sort</span>
          <Select
            value={mobileSortKey}
            onValueChange={(value) => onMobileSortChange(value as MobileSortKey)}
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

      {runs.length === 0 ? (
        <div className="border-border/70 text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-[12px]">
          {searchQuery ? `No runs found for "${searchQuery}"` : "No runs found"}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const metrics = getMetrics(run.run_metrics);
            const status = run.status as RunStatus;
            const hasMetrics = metrics !== null && (status === "completed" || status === "failed");
            const activeProgress =
              status === "running" || status === "waiting_for_data"
                ? (progressMap[run.id] ?? null)
                : null;
            const strategyLabel = STRATEGY_LABELS[run.strategy_id as StrategyId] ?? run.strategy_id;
            const universeLabel =
              typeof run.universe === "string" && run.universe.trim().length > 0
                ? run.universe
                : null;

            return (
              <article
                key={run.id}
                role="link"
                tabIndex={0}
                onClick={() => onOpenRun(run.id)}
                onKeyDown={(event) => onCardKeyDown(event, run.id)}
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
  );
}
