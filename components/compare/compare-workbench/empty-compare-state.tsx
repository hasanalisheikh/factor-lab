import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyCompareState({ bundleCount }: { bundleCount: number }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-foreground text-[13px] font-medium">
          At least two completed runs are required to compare.
        </p>
        <p className="text-muted-foreground max-w-[320px] text-[12px]">
          {bundleCount === 0
            ? "You don't have any completed runs yet. Create a backtest run to get started."
            : "You only have one completed run. Create another backtest to enable comparison."}
        </p>
        <Link href="/runs/new">
          <Button size="sm" className="mt-1 h-8 text-[12px] font-medium">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Run
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
