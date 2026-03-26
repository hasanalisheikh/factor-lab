"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloneRunAction } from "@/app/actions/runs";

interface RerunButtonProps {
  runId: string;
}

export function RerunButton({ runId }: RerunButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const result = await cloneRunAction(runId);
    if (result.ok) {
      router.push(`/runs/${result.newRunId}`);
    } else {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 border-amber-700/50 bg-amber-950/40 text-[11px] font-medium text-amber-300 hover:bg-amber-900/50 hover:text-amber-200"
        onClick={handleClick}
        disabled={loading}
      >
        <RefreshCw className={`mr-1.5 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Creating…" : "Re-run to Latest"}
      </Button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
