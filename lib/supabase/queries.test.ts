import { describe, expect, it } from "vitest";
import { classifyUniverseBatchStatus } from "@/lib/supabase/queries";

describe("classifyUniverseBatchStatus", () => {
  it("keeps retrying batches non-terminal", () => {
    const result = classifyUniverseBatchStatus([
      { status: "retrying", progress: 100, next_retry_at: "2026-03-13T00:00:00Z" },
      { status: "succeeded", progress: 100, next_retry_at: null },
    ]);

    expect(result.status).toBe("pending");
  });

  it("marks failed jobs without a retry path as blocked", () => {
    const result = classifyUniverseBatchStatus([
      { status: "failed", progress: 100, next_retry_at: null },
      { status: "succeeded", progress: 100, next_retry_at: null },
    ]);

    expect(result.status).toBe("blocked");
  });

  it("treats zero-row succeeded jobs as completed", () => {
    const result = classifyUniverseBatchStatus([
      { status: "succeeded", progress: 100, next_retry_at: null },
      { status: "succeeded", progress: 100, next_retry_at: null },
    ]);

    expect(result.status).toBe("succeeded");
    expect(result.completedJobs).toBe(2);
    expect(result.avgProgress).toBe(100);
  });
});
