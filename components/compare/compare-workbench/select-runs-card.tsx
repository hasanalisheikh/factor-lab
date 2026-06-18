import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import type { CompareRunBundle } from "@/lib/supabase/types";

type SelectRunsCardProps = {
  bundles: CompareRunBundle[];
  runAId: string;
  runBId: string;
  onRunAChange: (runId: string) => void;
  onRunBChange: (runId: string) => void;
};

export function SelectRunsCard({
  bundles,
  runAId,
  runBId,
  onRunAChange,
  onRunBChange,
}: SelectRunsCardProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-foreground text-sm font-semibold">Select Runs</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Run A</p>
          <NativeSelect
            value={runAId}
            onChange={(event) => onRunAChange(event.target.value)}
            className="border-input h-9 bg-transparent px-3 pr-8 text-sm"
            iconClassName="opacity-50"
          >
            {bundles.map((bundle) => (
              <option key={`a-${bundle.run.id}`} value={bundle.run.id}>
                {bundle.run.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Run B</p>
          <NativeSelect
            value={runBId}
            onChange={(event) => onRunBChange(event.target.value)}
            className="border-input h-9 bg-transparent px-3 pr-8 text-sm"
            iconClassName="opacity-50"
          >
            {bundles.map((bundle) => (
              <option key={`b-${bundle.run.id}`} value={bundle.run.id}>
                {bundle.run.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardContent>
    </Card>
  );
}
