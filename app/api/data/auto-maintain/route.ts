/**
 * Backward-compatible shim for the old auto-maintain endpoint.
 *
 * The old behavior queued stale/missing jobs toward "today" and was safe to
 * call on page load, which caused the ingestion storms this release removes.
 * Keep the route for compatibility, but delegate to the cutoff-aware daily
 * refresh scheduler instead.
 */

import { type NextRequest } from "next/server";
import { runScheduledRefresh } from "@/app/api/cron/_lib/refresh";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  return runScheduledRefresh(request, "daily");
}
