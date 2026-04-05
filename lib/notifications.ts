import type { NotificationRow } from "@/lib/supabase/types";

export type JobNotificationStatus = "queued" | "running" | "completed" | "failed" | "blocked";

type JobNotificationPresentation = Pick<NotificationRow, "title" | "body" | "level">;

export function buildJobNotification({
  status,
  name,
  errorMessage,
}: {
  status: JobNotificationStatus;
  name: string;
  errorMessage?: string | null;
}): JobNotificationPresentation {
  switch (status) {
    case "completed":
      return {
        title: `Run completed: ${name}`,
        body: "Your run finished successfully.",
        level: "success",
      };
    case "failed":
      return {
        title: `Run failed: ${name}`,
        body: errorMessage ?? "Your run failed. Open the job details for more information.",
        level: "error",
      };
    case "blocked":
      return {
        title: `Run blocked: ${name}`,
        body: errorMessage ?? "Your run was blocked. Open the job details for more information.",
        level: "warning",
      };
    case "running":
      return {
        title: `Job running: ${name}`,
        body: "Your run is now processing.",
        level: "info",
      };
    case "queued":
    default:
      return {
        title: `Job queued: ${name}`,
        body: "Your run is queued and will start soon.",
        level: "info",
      };
  }
}

export function inferJobNotificationStatus(notification: Pick<NotificationRow, "title" | "level">) {
  if (notification.title.startsWith("Run completed:")) return "completed";
  if (notification.title.startsWith("Run failed:")) return "failed";
  if (notification.title.startsWith("Run blocked:")) return "blocked";
  if (notification.title.startsWith("Job running:")) return "running";
  if (notification.title.startsWith("Job queued:")) return "queued";

  switch (notification.level) {
    case "success":
      return "completed";
    case "error":
      return "failed";
    case "warning":
      return "blocked";
    default:
      return "queued";
  }
}
