"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateRunReport, type GenerateRunReportState } from "@/app/actions/reports";

interface GenerateReportButtonProps {
  runId: string;
}

export function GenerateReportButton({ runId }: GenerateReportButtonProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<GenerateRunReportState, FormData>(
    generateRunReport,
    null
  );
  const reportUrl = state?.success ? state.url : null;
  const errorMessage = state?.success === false ? state.error : null;

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [router, state?.success]);

  return (
    <div className="flex flex-col items-end gap-1">
      {reportUrl ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="border-border text-muted-foreground hover:text-foreground h-8 shrink-0 text-[12px] font-medium"
        >
          <a href={reportUrl} target="_blank" rel="noreferrer">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download Report
          </a>
        </Button>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="runId" value={runId} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending}
            className="border-border text-muted-foreground hover:text-foreground h-8 shrink-0 text-[12px] font-medium"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isPending ? "Generating…" : "Generate Report"}
          </Button>
        </form>
      )}
      {errorMessage && (
        <p className="text-destructive max-w-[220px] text-right text-[11px] leading-snug">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
