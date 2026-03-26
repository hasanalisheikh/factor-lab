import { render, screen, act, cleanup } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { JobStatusPanel } from "@/components/run-detail/job-status-panel";
import type { JobRow } from "@/lib/supabase/types";

const BASE_TIME = new Date("2026-03-26T12:00:00Z").getTime();

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    run_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    status: "queued",
    stage: "ingest",
    progress: 0,
    error_message: null,
    created_at: new Date(BASE_TIME).toISOString(),
    started_at: null,
    finished_at: null,
    duration: null,
    updated_at: null,
    attempt_count: 0,
    next_retry_at: null,
    locked_at: null,
    job_type: "backtest",
    payload: null,
    preflight_run_id: null,
    ...overrides,
  };
}

describe("JobStatusPanel — queued state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows pickup message at 0 s elapsed", async () => {
    const job = makeJob({ created_at: new Date(BASE_TIME).toISOString() });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="queued" />);
    });
    expect(screen.getByText(/Waiting for worker pickup/i)).toBeInTheDocument();
    expect(screen.getByText(/0s elapsed/i)).toBeInTheDocument();
  });

  it("shows 'Still in queue' message between 30 s and 2 min", async () => {
    const elapsed = 45;
    const job = makeJob({ created_at: new Date(BASE_TIME - elapsed * 1000).toISOString() });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="queued" />);
    });
    expect(screen.getByText(/Still in queue/i)).toBeInTheDocument();
    expect(screen.getByText(/45s elapsed/i)).toBeInTheDocument();
  });

  it("shows 'worker may be processing other jobs' message after 2 min", async () => {
    const elapsed = 150;
    const job = makeJob({ created_at: new Date(BASE_TIME - elapsed * 1000).toISOString() });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="queued" />);
    });
    expect(screen.getByText(/worker may be processing other jobs/i)).toBeInTheDocument();
    expect(screen.getByText(/2m 30s/i)).toBeInTheDocument();
  });

  it("never shows the misleading 'usually starts in seconds' phrase", async () => {
    // Test across all elapsed time buckets
    for (const elapsed of [0, 5, 45, 150, 300]) {
      const job = makeJob({ created_at: new Date(BASE_TIME - elapsed * 1000).toISOString() });
      const { unmount } = await act(async () => {
        return render(<JobStatusPanel job={job} runStatus="queued" />);
      });
      expect(screen.queryByText(/usually starts in seconds/i)).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("JobStatusPanel — running state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows stage description with elapsed time", async () => {
    const startedSecondsAgo = 72;
    const job = makeJob({
      status: "running",
      stage: "rebalance",
      progress: 60,
      started_at: new Date(BASE_TIME - startedSecondsAgo * 1000).toISOString(),
    });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="running" />);
    });
    // Description should include stage description text
    expect(
      screen.getByText(/Building portfolio weights and applying transaction costs/i)
    ).toBeInTheDocument();
    // And the elapsed time
    expect(screen.getByText(/1m 12s elapsed/i)).toBeInTheDocument();
  });

  it("shows 'Generating report' label for the report stage", async () => {
    const job = makeJob({
      status: "running",
      stage: "report",
      progress: 95,
      started_at: new Date(BASE_TIME - 10000).toISOString(),
    });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="running" />);
    });
    expect(screen.getByText(/Generating report/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Finalizing$/i)).not.toBeInTheDocument();
  });

  it("shows report stage description for report stage", async () => {
    const job = makeJob({
      status: "running",
      stage: "report",
      progress: 95,
      started_at: new Date(BASE_TIME - 5000).toISOString(),
    });
    await act(async () => {
      render(<JobStatusPanel job={job} runStatus="running" />);
    });
    expect(screen.getByText(/Building the HTML performance report/i)).toBeInTheDocument();
  });
});

describe("JobStatusPanel — waiting_for_data state", () => {
  it("shows ingest progress with elapsed time", async () => {
    const ingestStartedSecondsAgo = 90;
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const job = makeJob({ status: "waiting_for_data" });
    await act(async () => {
      render(
        <JobStatusPanel
          job={job}
          runStatus="waiting_for_data"
          ingestProgress={{
            totalJobs: 5,
            completedJobs: 2,
            avgProgress: 40,
            minStartedAt: new Date(BASE_TIME - ingestStartedSecondsAgo * 1000).toISOString(),
            symbols: [],
          }}
        />
      );
    });
    expect(screen.getByText(/Downloading data for 5 tickers/i)).toBeInTheDocument();
    expect(screen.getByText(/2\/5 done/i)).toBeInTheDocument();
    expect(screen.getByText(/1m 30s elapsed/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("JobStatusPanel — failed / blocked state", () => {
  it("shows error message for failed runs", () => {
    const job = makeJob({ status: "failed", error_message: "Something went wrong" });
    render(<JobStatusPanel job={job} runStatus="failed" />);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("returns null for completed runs", () => {
    const { container } = render(<JobStatusPanel job={null} runStatus="completed" />);
    expect(container.firstChild).toBeNull();
  });
});
