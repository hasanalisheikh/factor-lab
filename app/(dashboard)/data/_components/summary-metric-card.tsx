import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/data/info-tooltip";

import type { ReactNode } from "react";

type SummaryMetricCardProps = {
  title: string;
  tooltip?: string;
  value: ReactNode;
  meta?: ReactNode;
  icon: ReactNode;
  valueClassName?: string;
};

export function SummaryMetricCard({
  title,
  tooltip,
  value,
  meta,
  icon,
  valueClassName = "text-2xl font-semibold text-foreground",
}: SummaryMetricCardProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground flex items-center text-xs font-medium">
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={valueClassName}>{value}</p>
          {meta && <div className="text-muted-foreground mt-1 text-xs">{meta}</div>}
        </div>
        <div className="flex-shrink-0">{icon}</div>
      </CardContent>
    </Card>
  );
}
