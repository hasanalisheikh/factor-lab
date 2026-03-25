import { describe, expect, it } from "vitest";

import {
  getDataIngestTriggerLabel,
  isActiveDataIngestStatus,
  isPollingDataIngestStatus,
  isMissingDataIngestExtendedColumnError,
  normalizeDataIngestStatus,
  stripExtendedDataIngestFields,
} from "@/lib/data-ingest-jobs";

describe("normalizeDataIngestStatus", () => {
  it("maps legacy completed rows to the succeeded status used by the UI", () => {
    expect(normalizeDataIngestStatus("completed")).toBe("succeeded");
    expect(normalizeDataIngestStatus("running")).toBe("running");
  });
});

describe("isActiveDataIngestStatus", () => {
  it("treats failed rows with a retry schedule as still active", () => {
    expect(isActiveDataIngestStatus("failed", "2026-03-13T00:00:00Z")).toBe(true);
    expect(isActiveDataIngestStatus("failed", null)).toBe(false);
  });
});

describe("isPollingDataIngestStatus", () => {
  it("only polls queued or running jobs that do not have finished_at yet", () => {
    expect(isPollingDataIngestStatus("queued", null)).toBe(true);
    expect(isPollingDataIngestStatus("running", null)).toBe(true);
    expect(isPollingDataIngestStatus("retrying", "2026-03-13T00:00:00Z")).toBe(false);
    expect(isPollingDataIngestStatus("succeeded", "2026-03-13T00:00:00Z")).toBe(false);
  });
});

describe("getDataIngestTriggerLabel", () => {
  it("labels scheduled and manual jobs truthfully", () => {
    expect(getDataIngestTriggerLabel("monthly", "cron:monthly-refresh")).toBe(
      "scheduled monthly refresh"
    );
    expect(getDataIngestTriggerLabel("daily", "cron:daily-refresh")).toBe("daily patch");
    expect(getDataIngestTriggerLabel("manual", "manual:123")).toBe("manual repair (admin)");
  });
});

describe("compat helpers", () => {
  it("strips only the extended 20260318 columns when falling back to the legacy schema", () => {
    expect(
      stripExtendedDataIngestFields({
        symbol: "SPY",
        request_mode: "manual",
        batch_id: "batch-1",
        target_cutoff_date: "2026-03-11",
        requested_by: "cron:daily",
        requested_by_user_id: "user-1",
        last_heartbeat_at: "2026-03-12T00:00:00Z",
        requested_by_run_id: "run-1",
      })
    ).toEqual({
      symbol: "SPY",
      requested_by_run_id: "run-1",
    });
  });

  it("detects missing extended-column errors from Postgres", () => {
    expect(
      isMissingDataIngestExtendedColumnError("column data_ingest_jobs.request_mode does not exist")
    ).toBe(true);
  });
});
