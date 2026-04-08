import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { retryQueuedRunWakeActionMock } = vi.hoisted(() => ({
  retryQueuedRunWakeActionMock: vi.fn(),
}));

vi.mock("@/app/actions/runs", () => ({
  retryQueuedRunWakeAction: retryQueuedRunWakeActionMock,
}));

import { JobStatusPanel } from "@/components/run-detail/job-status-panel";
import type { JobRow } from "@/lib/supabase/types";

const BASE_TIME = new Date("2026-03-26T12:00:00Z").getTime();

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

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
    claimed_at: null,
    worker_id: null,
    heartbeat_at: null,
    ...overrides,
  };
}

describe("JobStatusPanel — queued state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    retryQueuedRunWakeActionMock.mockReset();
    retryQueuedRunWakeActionMock.mockResolvedValue({ attempted: true, reason: "triggered" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows pickup message at 0 s elapsed", async () => {
    const job = makeJob({ created_at: new Date(BASE_TIME).toISOString() });
    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });
    expect(screen.getByText("Waiting for worker…")).toBeInTheDocument();
    expect(screen.getByText(/0s elapsed/i)).toBeInTheDocument();
  });

  it("shows 'Starting worker' after the initial waiting window", async () => {
    const elapsed = 20;
    const job = makeJob({ created_at: new Date(BASE_TIME - elapsed * 1000).toISOString() });
    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });
    expect(screen.getByText("Starting worker…")).toBeInTheDocument();
    expect(screen.getByText(/20s elapsed/i)).toBeInTheDocument();
  });

  it("fires the first retry once and updates the queued copy", async () => {
    const job = makeJob({ created_at: new Date(BASE_TIME).toISOString() });
    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });

    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });

    expect(retryQueuedRunWakeActionMock).toHaveBeenCalledTimes(1);
    expect(retryQueuedRunWakeActionMock).toHaveBeenCalledWith("run-1", 1);
    expect(screen.getByText("Worker still starting — retrying…")).toBeInTheDocument();
    expect(screen.getByText(/sent another wake-up request/i)).toBeInTheDocument();
  });

  it("fires the second retry once, then stops retrying automatically", async () => {
    const job = makeJob({ created_at: new Date(BASE_TIME).toISOString() });
    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });

    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(180_000);
      await Promise.resolve();
    });

    expect(retryQueuedRunWakeActionMock).toHaveBeenCalledTimes(2);
    expect(retryQueuedRunWakeActionMock).toHaveBeenNthCalledWith(1, "run-1", 1);
    expect(retryQueuedRunWakeActionMock).toHaveBeenNthCalledWith(2, "run-1", 2);
    expect(
      screen.getByText(
        "Worker is taking longer than expected. We’ll keep trying in the background."
      )
    ).toBeInTheDocument();
  });

  it("shows 'Worker started. Preparing run…' as soon as claim metadata exists", async () => {
    const job = makeJob({
      claimed_at: new Date(BASE_TIME - 10_000).toISOString(),
    });
    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });

    expect(screen.getByText("Worker started. Preparing run…")).toBeInTheDocument();
    expect(retryQueuedRunWakeActionMock).not.toHaveBeenCalled();
  });

  it("does not retry once the worker has been claimed by worker_id or started_at", async () => {
    for (const override of [
      { worker_id: "worker-1" },
      { started_at: new Date(BASE_TIME - 5_000).toISOString() },
    ]) {
      cleanup();
      window.sessionStorage.clear();
      retryQueuedRunWakeActionMock.mockClear();

      await act(async () => {
        render(<JobStatusPanel runId="run-1" job={makeJob(override)} runStatus="queued" />);
      });

      await act(async () => {
        vi.advanceTimersByTime(150_000);
        await Promise.resolve();
      });

      expect(retryQueuedRunWakeActionMock).not.toHaveBeenCalled();
      expect(screen.getByText("Worker started. Preparing run…")).toBeInTheDocument();
    }
  });

  it("restores fired retry ordinals after remount and does not repeat the same retry", async () => {
    const job = makeJob({ created_at: new Date(BASE_TIME).toISOString() });
    let view: ReturnType<typeof render> | null = null;

    await act(async () => {
      view = render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
    });

    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });

    view?.unmount();

    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(retryQueuedRunWakeActionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Worker still starting — retrying…")).toBeInTheDocument();
  });

  it("never shows the misleading 'usually starts in seconds' phrase", async () => {
    for (const elapsed of [0, 5, 45, 150, 300]) {
      const job = makeJob({ created_at: new Date(BASE_TIME - elapsed * 1000).toISOString() });
      const { unmount } = await act(async () => {
        return render(<JobStatusPanel runId="run-1" job={job} runStatus="queued" />);
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
      render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);
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
      render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);
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
      render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);
    });
    expect(screen.getByText(/Building the HTML performance report/i)).toBeInTheDocument();
  });

  it("shows a finishing state at 100% with no ETA when the job completes first", async () => {
    const startedSecondsAgo = 90;
    const job = makeJob({
      status: "completed",
      stage: "report",
      progress: 88,
      started_at: new Date(BASE_TIME - startedSecondsAgo * 1000).toISOString(),
    });

    await act(async () => {
      render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);
    });

    expect(screen.getByText(/Finalizing results/i)).toBeInTheDocument();
    expect(screen.getByText(/Writing final results and report data/i)).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText(/88%/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Building the HTML performance report/i)).not.toBeInTheDocument();
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
          runId="run-1"
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
    render(<JobStatusPanel runId="run-1" job={job} runStatus="failed" />);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("shows terminal failed state immediately when the job fails before the run row catches up", () => {
    const job = makeJob({
      status: "failed",
      progress: 88,
      error_message: "Something went wrong",
    });

    render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);

    expect(screen.getByText(/Run failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/88%/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Running backtest/i)).not.toBeInTheDocument();
  });

  it("does not show stale running progress for blocked states", () => {
    const job = makeJob({
      status: "blocked",
      progress: 92,
      error_message: "Coverage gap",
    });

    render(<JobStatusPanel runId="run-1" job={job} runStatus="running" />);

    expect(screen.getByText(/Run blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/Coverage gap/i)).toBeInTheDocument();
    expect(screen.queryByText(/92%/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Running backtest/i)).not.toBeInTheDocument();
  });

  it("returns null for completed runs", () => {
    const { container } = render(<JobStatusPanel runId="run-1" job={null} runStatus="completed" />);
    expect(container.firstChild).toBeNull();
  });
});
