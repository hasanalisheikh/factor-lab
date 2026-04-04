import { describe, expect, it } from "vitest";
import { getRunPreflightSnapshot } from "@/lib/run-preflight-snapshot";

describe("getRunPreflightSnapshot", () => {
  it("prefers the run-specific required end when it is earlier than the global data cutoff", () => {
    const snapshot = getRunPreflightSnapshot({
      run_params: {
        preflight: {
          data_cutoff_date: "2026-04-03",
          required_end: "2026-04-02",
          universe_earliest_start: "2004-11-18",
          benchmark_coverage_health: {
            status: "good",
            reason: null,
          },
        },
      },
    });

    expect(snapshot).toEqual({
      dataCutoffUsed: "2026-04-02",
      universeEarliestStart: "2004-11-18",
      benchmarkCoverageHealth: {
        status: "Good",
        reason: null,
      },
    });
  });

  it("falls back to the global data cutoff when required_end is missing", () => {
    const snapshot = getRunPreflightSnapshot({
      run_params: {
        preflight: {
          data_cutoff_date: "2026-04-03",
        },
      },
    });

    expect(snapshot.dataCutoffUsed).toBe("2026-04-03");
  });

  it("caps the displayed date at the global cutoff if required_end is later", () => {
    const snapshot = getRunPreflightSnapshot({
      run_params: {
        preflight: {
          data_cutoff_date: "2026-04-03",
          required_end: "2026-04-04",
        },
      },
    });

    expect(snapshot.dataCutoffUsed).toBe("2026-04-03");
  });
});
