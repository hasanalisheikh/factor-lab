import { describe, expect, it } from "vitest"
import { buildReportStoragePath, resolveReportsBucketName } from "@/lib/storage"

describe("resolveReportsBucketName", () => {
  it("returns 'reports' when called with undefined (env var not set)", () => {
    expect(resolveReportsBucketName(undefined)).toBe("reports")
  })

  it("returns 'reports' when called with empty string (SUPABASE_REPORTS_BUCKET=)", () => {
    // This is the Vercel bug: ?? does not catch "", but our || fallback does.
    expect(resolveReportsBucketName("")).toBe("reports")
  })

  it("returns 'reports' after trimming whitespace-only string", () => {
    expect(resolveReportsBucketName("  ")).toBe("reports")
  })

  it("returns 'reports' after trimming surrounding whitespace", () => {
    expect(resolveReportsBucketName("  reports  ")).toBe("reports")
  })

  it("returns the provided value unchanged when already valid", () => {
    expect(resolveReportsBucketName("reports")).toBe("reports")
  })

  it("accepts a custom valid bucket name", () => {
    expect(resolveReportsBucketName("my-reports")).toBe("my-reports")
  })

  it("falls back to 'reports' for corrupted env values like 'Vercel CLI 50.20.0'", () => {
    expect(resolveReportsBucketName("Vercel CLI 50.20.0")).toBe("reports")
  })

  it("falls back to 'reports' for uppercase + special chars", () => {
    expect(resolveReportsBucketName("INVALID BUCKET!")).toBe("reports")
  })

  it("falls back to 'reports' for uppercase-only names", () => {
    expect(resolveReportsBucketName("REPORTS")).toBe("reports")
  })

  it("falls back to 'reports' for names shorter than 3 characters", () => {
    expect(resolveReportsBucketName("ab")).toBe("reports")
  })

  it("falls back to 'reports' for names with leading hyphens", () => {
    expect(resolveReportsBucketName("-reports")).toBe("reports")
  })

  it("falls back to 'reports' for names with trailing hyphens", () => {
    expect(resolveReportsBucketName("reports-")).toBe("reports")
  })

  it("falls back to 'reports' for path-like strings with slashes", () => {
    expect(resolveReportsBucketName("reports/production")).toBe("reports")
  })
})

describe("buildReportStoragePath", () => {
  it("returns '<runId>/tearsheet.html' for a simple ID", () => {
    expect(buildReportStoragePath("abc-123")).toBe("abc-123/tearsheet.html")
  })

  it("correctly formats a full UUID run ID", () => {
    const runId = "550e8400-e29b-41d4-a716-446655440000"
    expect(buildReportStoragePath(runId)).toBe(`${runId}/tearsheet.html`)
  })

  it("never mutates the bucket name — path is object key only", () => {
    const path = buildReportStoragePath("my-run-id")
    expect(path).not.toContain("reports")
    expect(path).toBe("my-run-id/tearsheet.html")
  })
})
