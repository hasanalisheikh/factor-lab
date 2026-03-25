"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CheckCircle, XCircle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LS_KEY = "fl_notifs_last_seen";

type NotifItem = {
  id: string;
  runId: string | null;
  title: string;
  createdAt: string;
  status: string;
};

function statusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
    case "failed":
      return <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />;
    case "blocked":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
    case "running":
      return <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />;
    default:
      return <Clock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />;
  }
}

function statusTitle(status: string, name: string): string {
  switch (status) {
    case "completed":
      return `Run completed: ${name}`;
    case "failed":
      return `Run failed: ${name}`;
    case "blocked":
      return `Run blocked: ${name}`;
    case "running":
      return `Job running: ${name}`;
    case "pending":
      return `Job queued: ${name}`;
    default:
      return `${name}: ${status}`;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TopbarNotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [storageKey, setStorageKey] = useState<string>(LS_KEY);
  const [lastSeen, setLastSeen] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const nextKey = data.user?.id ? `${LS_KEY}:${data.user.id}` : LS_KEY;
        setStorageKey(nextKey);
        setLastSeen(typeof window !== "undefined" ? (localStorage.getItem(nextKey) ?? "") : "");
      })
      .catch(() => {
        if (cancelled) return;
        setStorageKey(LS_KEY);
        setLastSeen(typeof window !== "undefined" ? (localStorage.getItem(LS_KEY) ?? "") : "");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch notifications whenever popover opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Fetch jobs + matching run names in two lightweight queries
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, run_id, name, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);

      if (cancelled || !jobs) {
        setLoading(false);
        return;
      }

      const runIds = jobs.map((j) => j.run_id).filter(Boolean) as string[];
      let runNames: Record<string, string> = {};

      if (runIds.length > 0) {
        const { data: runs } = await supabase.from("runs").select("id, name").in("id", runIds);
        if (runs) {
          runNames = Object.fromEntries(runs.map((r) => [r.id, r.name]));
        }
      }

      if (!cancelled) {
        setItems(
          jobs.map((j) => ({
            id: j.id,
            runId: j.run_id,
            title: statusTitle(j.status, j.run_id ? (runNames[j.run_id] ?? j.name) : j.name),
            createdAt: j.created_at,
            status: j.status,
          }))
        );
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasUnread = items.some((i) => !lastSeen || i.createdAt > lastSeen);

  function markAllRead() {
    const now = new Date().toISOString();
    localStorage.setItem(storageKey, now);
    setLastSeen(now);
  }

  function handleClick(item: NotifItem) {
    setOpen(false);
    router.push(item.runId ? `/runs/${item.runId}` : "/jobs");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative h-8 w-8"
          aria-label="Notifications"
        >
          <Bell className="h-[15px] w-[15px]" />
          {hasUnread && (
            <span className="bg-primary absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        avoidCollisions
        collisionPadding={12}
        className="w-80 max-w-[90vw] p-0"
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-foreground text-[13px] font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px]"
          >
            <CheckCheck className="mr-1 h-3 w-3" />
            Mark all read
          </Button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-[12px]">No recent activity</p>
        ) : (
          <ul className="max-h-[340px] overflow-y-auto">
            {items.map((item) => {
              const isUnread = !lastSeen || item.createdAt > lastSeen;
              return (
                <li
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={cn(
                    "border-border/60 flex items-start gap-2.5 border-b px-4 py-3 last:border-b-0",
                    "hover:bg-accent/50 cursor-pointer transition-colors",
                    isUnread && "bg-primary/[0.04]"
                  )}
                >
                  <div className="mt-0.5">{statusIcon(item.status)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-[12px] leading-snug">
                      {item.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      {relativeTime(item.createdAt)}
                    </p>
                  </div>
                  {isUnread && (
                    <span className="bg-primary mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer */}
        <div className="border-border border-t px-4 py-2">
          <button
            onClick={() => {
              setOpen(false);
              router.push("/jobs");
            }}
            className="text-muted-foreground hover:text-foreground text-[11px] transition-colors"
          >
            View all jobs →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
