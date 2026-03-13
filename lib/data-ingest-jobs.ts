const EXTENDED_DATA_INGEST_COLUMNS = [
  "request_mode",
  "batch_id",
  "target_cutoff_date",
  "requested_by",
  "requested_by_user_id",
  "last_heartbeat_at",
  "rows_inserted",
] as const

export function isMissingDataIngestExtendedColumnError(message?: string | null): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return (
    (lower.includes("data_ingest_jobs") || lower.includes("schema cache")) &&
    (lower.includes("does not exist") || lower.includes("could not find")) &&
    EXTENDED_DATA_INGEST_COLUMNS.some((column) => lower.includes(column))
  )
}

export function stripExtendedDataIngestFields<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  delete copy.request_mode
  delete copy.batch_id
  delete copy.target_cutoff_date
  delete copy.requested_by
  delete copy.requested_by_user_id
  delete copy.last_heartbeat_at
  delete copy.rows_inserted
  return copy
}

export function normalizeDataIngestStatus(status: string | null | undefined): string {
  if (!status) return "queued"
  return status === "completed" ? "succeeded" : status
}

export function isScheduledRetry(
  status: string | null | undefined,
  nextRetryAt: string | null | undefined,
): boolean {
  const normalized = normalizeDataIngestStatus(status)
  return normalized === "retrying" || (normalized === "failed" && Boolean(nextRetryAt))
}

export function isActiveDataIngestStatus(
  status: string | null | undefined,
  nextRetryAt: string | null | undefined,
): boolean {
  const normalized = normalizeDataIngestStatus(status)
  return normalized === "queued" || normalized === "running" || isScheduledRetry(normalized, nextRetryAt)
}

export function isPollingDataIngestStatus(
  status: string | null | undefined,
  finishedAt: string | null | undefined,
): boolean {
  if (finishedAt) return false
  const normalized = normalizeDataIngestStatus(status)
  return normalized === "queued" || normalized === "running"
}

export function getDataIngestTriggerLabel(
  requestMode: string | null | undefined,
  requestedBy: string | null | undefined,
): string {
  const mode = (requestMode ?? "").toLowerCase()
  const requested = (requestedBy ?? "").toLowerCase()

  if (mode === "monthly" || requested.startsWith("cron:monthly")) {
    return "scheduled monthly refresh"
  }
  if (mode === "daily" || requested.startsWith("cron:daily")) {
    return "daily patch"
  }
  if (mode === "manual" || requested.startsWith("manual")) {
    return "manual repair (admin)"
  }
  if (mode === "preflight" || requested.startsWith("run-preflight")) {
    return "run preflight"
  }
  return "data repair"
}
