import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompareRunBundle } from "@/lib/supabase/types";

import { METRICS } from "./chart-data";

type MetricDiffCardProps = {
  runA: CompareRunBundle;
  runB: CompareRunBundle;
};

export function MetricDiffCard({ runA, runB }: MetricDiffCardProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-foreground text-sm font-semibold">Metric Diff</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-border/70 text-muted-foreground border-b">
                <th className="py-2 pr-3 text-left font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium">Run A</th>
                <th className="px-3 py-2 text-right font-medium">Run B</th>
                <th className="py-2 pl-3 text-right font-medium">Difference (A-B)</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const a = Number(runA.metrics[metric.key]);
                const b = Number(runB.metrics[metric.key]);
                const diff = a - b;
                const aWins = metric.higherIsBetter ? a > b : a < b;
                const bWins = metric.higherIsBetter ? b > a : b < a;

                return (
                  <tr key={metric.key} className="border-border/40 border-b last:border-0">
                    <td className="text-foreground py-2 pr-3 font-medium">{metric.label}</td>
                    <td className={`px-3 py-2 text-right font-mono ${aWins ? "text-success" : ""}`}>
                      {metric.format(a)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${bWins ? "text-success" : ""}`}>
                      {metric.format(b)}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right font-mono ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-success" : "text-destructive"}`}
                    >
                      {diff >= 0 ? "+" : ""}
                      {metric.key === "sharpe" ? diff.toFixed(2) : `${(diff * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
