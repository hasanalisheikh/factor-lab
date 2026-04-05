"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CheckCircle, Clock, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { inferJobNotificationStatus } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

type NotifItem = {
  id: string;
  runId: string | null;
  jobId: string | null;
  title: string;
  body: string | null;
  createdAt: string;
  level: NotificationRow["level"];
  readAt: string | null;
};

function statusIcon(item: Pick<NotifItem, "title" | "level">) {
  switch (inferJobNotificationStatus(item)) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
    case "failed":
      return <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />;
    case "blocked":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
    case "running":
      return <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />;
    case "queued":
    default:
      return <Clock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />;
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
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function load(showSpinner: boolean) {
      if (showSpinner) {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("notifications")
        .select("id, run_id, job_id, title, body, level, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (cancelled) return;

      if (error) {
        console.warn("[notifications] load warning:", error.message);
        setLoading(false);
        return;
      }

      setItems(
        (data ?? []).map((item) => ({
          id: item.id,
          runId: item.run_id,
          jobId: item.job_id,
          title: item.title,
          body: item.body,
          createdAt: item.created_at,
          level: item.level,
          readAt: item.read_at,
        }))
      );

      setLoading(false);
    }

    void load(open);

    const intervalId = window.setInterval(() => {
      void load(false);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [open]);

  const hasUnread = items.some((item) => item.readAt == null);

  async function markAllRead() {
    if (items.length === 0 || !hasUnread) return;

    const now = new Date().toISOString();
    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);

    if (error) {
      console.warn("[notifications] markAllRead warning:", error.message);
      return;
    }

    setItems((current) =>
      current.map((item) => ({
        ...item,
        readAt: item.readAt ?? now,
      }))
    );
  }

  async function markOneRead(notificationId: string) {
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.id === notificationId
          ? {
              ...item,
              readAt: item.readAt ?? now,
            }
          : item
      )
    );

    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("id", notificationId)
      .is("read_at", null);

    if (error) {
      console.warn("[notifications] markOneRead warning:", error.message);
    }
  }

  function handleClick(item: NotifItem) {
    setOpen(false);
    if (item.readAt == null) {
      void markOneRead(item.id);
    }
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
        <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-foreground text-[13px] font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={!hasUnread}
            className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px]"
          >
            <CheckCheck className="mr-1 h-3 w-3" />
            Mark all read
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-[12px]">No recent activity</p>
        ) : (
          <ul className="max-h-[340px] overflow-y-auto">
            {items.map((item) => {
              const isUnread = item.readAt == null;
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
                  <div className="mt-0.5">{statusIcon(item)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-[12px] leading-snug">
                      {item.title}
                    </p>
                    {item.body && (
                      <p className="text-muted-foreground/80 truncate text-[11px] leading-snug">
                        {item.body}
                      </p>
                    )}
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
