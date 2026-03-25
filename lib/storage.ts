/**
 * Pure storage utility functions for Supabase Storage operations.
 * No I/O, no server-only imports — safe in tests and both server/client contexts.
 */

/**
 * Valid Supabase bucket name: lowercase letters, numbers, hyphens.
 * 3–63 characters, starting and ending with a letter or number.
 */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$|^[a-z0-9]{3}$/;

/**
 * Resolve the reports bucket name from the optional env var value.
 *
 * - Trims whitespace.
 * - Falls back to "reports" when the result is empty, null, or undefined.
 * - Falls back to "reports" with a console warning when the env var is set to
 *   an invalid value (e.g. a corrupted Vercel env entry). Report generation
 *   still succeeds; the warning surfaces in server logs for diagnosis.
 */
export function resolveReportsBucketName(envValue?: string): string {
  const trimmed = (envValue ?? "").trim();
  const candidate = trimmed.length > 0 ? trimmed : "reports";

  if (!BUCKET_NAME_PATTERN.test(candidate)) {
    console.warn(
      `[storage] SUPABASE_REPORTS_BUCKET "${candidate}" is not a valid bucket name — ` +
        `falling back to "reports". ` +
        `Remove or correct the SUPABASE_REPORTS_BUCKET environment variable.`
    );
    return "reports";
  }

  return candidate;
}

/**
 * Build the storage object path for a run tearsheet inside the reports bucket.
 * Pattern: <run-id>/tearsheet.html
 */
export function buildReportStoragePath(runId: string): string {
  return `${runId}/tearsheet.html`;
}
