import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type BenchmarkRowActionsProps = {
  diagnosticsEnabled: boolean;
  isSubmitting: boolean;
  isStalled: boolean;
  isBlocked: boolean;
  showBackfillBtn: boolean;
  showOptionalFullHistoryBtn: boolean;
  showIngestBtn: boolean;
  showRetryBtn: boolean;
  showRetryNowBtn: boolean;
  showCancelBtn: boolean;
  showUpToDateLabel: boolean;
  actionStartDate?: string;
  onAction: (forceStart?: string) => void;
  onCancel: () => void;
};

export function BenchmarkRowActions({
  diagnosticsEnabled,
  isSubmitting,
  isStalled,
  isBlocked,
  showBackfillBtn,
  showOptionalFullHistoryBtn,
  showIngestBtn,
  showRetryBtn,
  showRetryNowBtn,
  showCancelBtn,
  showUpToDateLabel,
  actionStartDate,
  onAction,
  onCancel,
}: BenchmarkRowActionsProps) {
  if (!diagnosticsEnabled) {
    return null;
  }

  return (
    <>
      {showBackfillBtn && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-6 flex-shrink-0 border-amber-800/50 px-2 text-[11px] text-amber-400 hover:text-amber-300"
              onClick={() => onAction(actionStartDate)}
              disabled={isSubmitting}
              title={
                showOptionalFullHistoryBtn
                  ? "Optional. Research window is already healthy."
                  : undefined
              }
            >
              {isSubmitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : showOptionalFullHistoryBtn ? (
                "Backfill full history"
              ) : (
                "Backfill"
              )}
            </Button>
          </TooltipTrigger>
          {showOptionalFullHistoryBtn && (
            <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
              Optional. Research window is already healthy.
            </TooltipContent>
          )}
        </Tooltip>
      )}
      {showIngestBtn && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 flex-shrink-0 px-2 text-[11px]"
          onClick={() => onAction()}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Ingest"}
        </Button>
      )}
      {showRetryBtn && (
        <Button
          size="sm"
          variant="outline"
          className={`h-6 flex-shrink-0 px-2 text-[11px] ${
            isStalled
              ? "border-amber-800/50 text-amber-400 hover:text-amber-300"
              : "border-red-800/50 text-red-400 hover:text-red-300"
          }`}
          onClick={() => onAction(actionStartDate)}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
        </Button>
      )}
      {showRetryNowBtn && (
        <Button
          size="sm"
          variant="outline"
          className={`h-6 flex-shrink-0 px-2 text-[11px] ${
            isBlocked
              ? "border-red-800/50 text-red-400 hover:text-red-300"
              : "border-amber-800/50 text-amber-400 hover:text-amber-300"
          }`}
          onClick={() => onAction(actionStartDate)}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry now"}
        </Button>
      )}
      {showCancelBtn && (
        <Button
          size="sm"
          variant="outline"
          className="border-muted-foreground/30 text-muted-foreground hover:text-foreground h-6 flex-shrink-0 px-2 text-[11px]"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel"}
        </Button>
      )}
      {showUpToDateLabel && (
        <span className="text-muted-foreground flex-shrink-0 text-[10px]">Up to date</span>
      )}
    </>
  );
}
