"use client";

import { Zap } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { RunPreflightResult } from "@/app/actions/runs";

function formatPreflightPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function PreflightBenchmarkDiagnostics({ result }: { result: RunPreflightResult }) {
  const benchmark = result.coverage.benchmark;
  if (!benchmark.windowStartUsed || !benchmark.windowEndUsed) return null;

  return (
    <div className="border-border/60 bg-muted/20 rounded-md border px-3 py-2.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        Benchmark Diagnostics
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <span className="text-muted-foreground">Window</span>
        <span className="text-foreground font-mono">
          {benchmark.windowStartUsed} to {benchmark.windowEndUsed}
        </span>
        <span className="text-muted-foreground">Source</span>
        <span className="text-foreground font-mono">{benchmark.metricSourceUsed}</span>
        <span className="text-muted-foreground">Expected days</span>
        <span className="text-foreground font-mono">{benchmark.expectedDays}</span>
        <span className="text-muted-foreground">Actual days</span>
        <span className="text-foreground font-mono">{benchmark.actualDays}</span>
        <span className="text-muted-foreground">Missing days</span>
        <span className="text-foreground font-mono">{benchmark.missingDays}</span>
        <span className="text-muted-foreground">True missing rate</span>
        <span className="text-foreground font-mono">
          {formatPreflightPercent(benchmark.trueMissingRate)}
        </span>
      </div>
    </div>
  );
}

export function RunFormSubmitButton({
  isPreflighting,
  isQueueDisabled,
  isSubmitting,
}: {
  isPreflighting: boolean;
  isQueueDisabled: boolean;
  isSubmitting: boolean;
}) {
  return (
    <Button
      type="submit"
      size="sm"
      disabled={isQueueDisabled}
      className="mt-1 h-8 w-full text-[12px] font-medium"
    >
      <Zap className="mr-1.5 h-3.5 w-3.5" />
      {isSubmitting ? "Queueing..." : isPreflighting ? "Checking..." : "Queue Backtest"}
    </Button>
  );
}

type PreflightDialogsProps = {
  applySuggestedFix: (kind: string, value?: string | number | string[]) => void | Promise<void>;
  blockResult: RunPreflightResult | null;
  diagnostics: boolean;
  runCreate: (acknowledgeWarnings: boolean) => Promise<void>;
  setBlockResult: (result: RunPreflightResult | null) => void;
  setWarnResult: (result: RunPreflightResult | null) => void;
  warnResult: RunPreflightResult | null;
};

export function PreflightDialogs({
  applySuggestedFix,
  blockResult,
  diagnostics,
  runCreate,
  setBlockResult,
  setWarnResult,
  warnResult,
}: PreflightDialogsProps) {
  const blockIssues = (blockResult?.issues ?? []).filter((issue) => issue.severity === "blocked");
  const warnIssues = (warnResult?.issues ?? []).filter((issue) => issue.severity === "warning");
  const hasOnlyEndDateBlock =
    blockIssues.length === 1 && blockIssues[0]?.code === "end_after_cutoff";

  return (
    <>
      <AlertDialog
        open={blockResult !== null}
        onOpenChange={(open) => !open && setBlockResult(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasOnlyEndDateBlock ? "End date unavailable" : "This run is blocked"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasOnlyEndDateBlock
                ? "Choose an available end date to continue."
                : "Fix these items before the run can be created."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            {blockIssues.map((issue) => {
              const action = issue.action;
              return (
                <div
                  key={`${issue.code}:${issue.reason}`}
                  className="border-border/60 bg-secondary/30 rounded-md border px-3 py-2.5"
                >
                  <p className="text-foreground text-sm">{issue.reason}</p>
                  <p className="text-muted-foreground mt-1 text-[12px]">{issue.fix}</p>
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
              );
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
            <DialogDescription>Review these warnings before you continue.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {warnIssues.map((issue) => {
              const action = issue.action;
              return (
                <div
                  key={`${issue.code}:${issue.reason}`}
                  className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2.5"
                >
                  <p className="text-foreground text-sm">{issue.reason}</p>
                  <p className="text-muted-foreground mt-1 text-[12px]">{issue.fix}</p>
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
              );
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
                setWarnResult(null);
                void runCreate(true);
              }}
            >
              Acknowledge and Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
