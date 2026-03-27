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
  const [message, setMessage] = useState<{ text: string; kind: "error" | "info" } | null>(null);

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await cloneRunAction(runId);
      if (result.ok) {
        router.push(`/runs/${result.newRunId}`);
      } else {
        setMessage({
          text: result.error,
          kind: result.alreadyCurrent ? "info" : "error",
        });
        setLoading(false);
      }
    } catch {
      setMessage({ text: "Something went wrong. Please try again.", kind: "error" });
      setLoading(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        className="border-border text-muted-foreground hover:text-foreground h-8 shrink-0 text-[12px] font-medium"
        onClick={handleClick}
        disabled={loading}
      >
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Creating…" : "Re-run to Latest"}
      </Button>
      {message && (
        <p
          className={`text-[10px] ${message.kind === "info" ? "text-muted-foreground" : "text-red-400"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
