/**
 * Pure storage utility functions for Supabase Storage operations.
 * No I/O, no server-only imports — safe in tests and both server/client contexts.
 */

/**
 * Valid Supabase bucket name: lowercase letters, numbers, hyphens.
 * 3–63 characters, starting and ending with a letter or number.
 */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$|^[a-z0-9]{3}$/

/**
 * Resolve the reports bucket name from the optional env var value.
 *
 * - Trims whitespace.
 * - Falls back to "reports" when the result is empty, null, or undefined.
 *   This handles both unset env vars AND env vars set to blank (SUPABASE_REPORTS_BUCKET=)
 *   which would silently break the `??` operator.
 * - Throws a developer-friendly error (never reaches production users) if the
 *   resolved name fails the safe-pattern check.
 */
export function resolveReportsBucketName(envValue?: string): string {
  const trimmed = (envValue ?? "").trim()
  const name = trimmed.length > 0 ? trimmed : "reports"

  if (!BUCKET_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid SUPABASE_REPORTS_BUCKET value "${name}". ` +
        `Bucket names must be 3–63 characters, lowercase letters, numbers, and hyphens only, ` +
        `starting and ending with a letter or number. ` +
        `Check the SUPABASE_REPORTS_BUCKET environment variable.`
    )
  }

  return name
}

/**
 * Build the storage object path for a run tearsheet inside the reports bucket.
 * Pattern: <run-id>/tearsheet.html
 */
export function buildReportStoragePath(runId: string): string {
  return `${runId}/tearsheet.html`
}
