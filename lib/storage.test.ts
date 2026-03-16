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

  it("throws with the bad value in the message for uppercase + spaces", () => {
    expect(() => resolveReportsBucketName("INVALID BUCKET!")).toThrow('"INVALID BUCKET!"')
  })

  it("throws for uppercase-only bucket names", () => {
    expect(() => resolveReportsBucketName("REPORTS")).toThrow(/Invalid SUPABASE_REPORTS_BUCKET/)
  })

  it("throws for bucket names shorter than 3 characters", () => {
    expect(() => resolveReportsBucketName("ab")).toThrow(/Invalid SUPABASE_REPORTS_BUCKET/)
  })

  it("throws for bucket names with leading hyphens", () => {
    expect(() => resolveReportsBucketName("-reports")).toThrow(/Invalid SUPABASE_REPORTS_BUCKET/)
  })

  it("throws for bucket names with trailing hyphens", () => {
    expect(() => resolveReportsBucketName("reports-")).toThrow(/Invalid SUPABASE_REPORTS_BUCKET/)
  })

  it("throws for bucket names with slashes (path-like strings)", () => {
    expect(() => resolveReportsBucketName("reports/production")).toThrow(
      /Invalid SUPABASE_REPORTS_BUCKET/
    )
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
