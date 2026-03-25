"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateRunReport } from "@/app/actions/reports";

interface GenerateReportButtonProps {
  runId: string;
}

export function GenerateReportButton({ runId }: GenerateReportButtonProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(generateRunReport, null);

  useEffect(() => {
    if (state && "success" in state) {
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="flex flex-col items-end gap-1">
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
      {state && "error" in state && (
        <p className="text-destructive max-w-[220px] text-right text-[11px] leading-snug">
          {state.error}
        </p>
      )}
    </div>
  );
}
