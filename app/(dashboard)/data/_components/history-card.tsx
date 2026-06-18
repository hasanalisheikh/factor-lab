import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatISODate, formatISOTimestamp } from "@/lib/utils/dates";

import type { DataIngestJobHistoryEntry } from "@/lib/supabase/queries";

function historyStatusClass(status: string): string {
  if (status === "succeeded") return "text-emerald-400";
  if (status === "queued" || status === "running") return "text-blue-400";
  if (status === "retrying") return "text-amber-400";
  return "text-red-400";
}

export function HistoryCard({
  rows,
  diagnostics,
}: {
  rows: DataIngestJobHistoryEntry[];
  diagnostics: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-foreground text-sm font-semibold">
          Ingestion Job History
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Recent refresh and repair jobs, labeled by their actual trigger.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">No ingestion jobs have been recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div
                key={row.id}
                className="border-border/50 border-b pb-2.5 last:border-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground text-xs font-medium">
                      <span className="font-mono">{row.symbol}</span>{" "}
                      <span className="text-muted-foreground">· {row.triggerLabel}</span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      Created {formatISOTimestamp(row.createdAt)}
                      {row.finishedAt ? ` · finished ${formatISOTimestamp(row.finishedAt)}` : ""}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      {row.rowsInserted.toLocaleString()} rows
                      {row.targetCutoffDate
                        ? ` · cutoff ${formatISODate(row.targetCutoffDate)}`
                        : ""}
                      {row.attemptCount ? ` · attempt ${row.attemptCount + 1}` : ""}
                    </p>
                    {row.nextRetryAt && (
                      <p className="mt-0.5 text-[11px] text-amber-400">
                        Retrying at {formatISOTimestamp(row.nextRetryAt)}
                      </p>
                    )}
                    {diagnostics && row.error && (
                      <p className="mt-0.5 text-[11px] break-words text-red-400">{row.error}</p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium capitalize ${historyStatusClass(row.status)}`}
                  >
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
