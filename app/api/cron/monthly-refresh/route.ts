import { type NextRequest } from "next/server"
import { runScheduledRefresh } from "../_lib/refresh"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  return runScheduledRefresh(request, "monthly")
}
