import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  browserSnapshot,
  createClientMock,
  jobMaybeSingleMock,
  refreshMock,
  reloadMock,
  runMaybeSingleMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  createClientMock: vi.fn(),
  runMaybeSingleMock: vi.fn(),
  jobMaybeSingleMock: vi.fn(),
  reloadMock: vi.fn(),
  browserSnapshot: {
    run: {
      data: { id: "run-1", status: "running" },
      error: null,
    } as {
      data: { id: string; status: string } | null;
      error: { message: string } | null;
    },
    job: {
      data: { status: "running", progress: 60 },
      error: null,
    } as {
      data: { status: string; progress: number } | null;
      error: { message: string } | null;
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

import { RunStatusPoller } from "@/components/run-detail/run-status-poller";

function buildSupabaseMock() {
  return {
    from(table: string) {
      if (table === "runs") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: runMaybeSingleMock,
                };
              },
            };
          },
        };
      }

      if (table === "jobs") {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle: jobMaybeSingleMock,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RunStatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockReset();
    reloadMock.mockReset();
    createClientMock.mockReset();
    runMaybeSingleMock.mockReset();
    jobMaybeSingleMock.mockReset();

    browserSnapshot.run = {
      data: { id: "run-1", status: "running" },
      error: null,
    };
    browserSnapshot.job = {
      data: { status: "running", progress: 60 },
      error: null,
    };

    createClientMock.mockReturnValue(buildSupabaseMock());
    runMaybeSingleMock.mockImplementation(async () => ({
      data: browserSnapshot.run.data ? { ...browserSnapshot.run.data } : null,
      error: browserSnapshot.run.error,
    }));
    jobMaybeSingleMock.mockImplementation(async () => ({
      data: browserSnapshot.job.data ? { ...browserSnapshot.job.data } : null,
      error: browserSnapshot.job.error,
    }));

    vi.stubGlobal("location", { reload: reloadMock } as unknown as Location);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("polls active runs on the base cadence while browser status stays active", async () => {
    render(<RunStatusPoller runId="run-1" status="running" jobStatus="running" />);
    await flushAsyncWork();

    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("triggers an immediate refresh burst when browser run status is terminal", async () => {
    browserSnapshot.run = {
      data: { id: "run-1", status: "completed" },
      error: null,
    };

    render(<RunStatusPoller runId="run-1" status="running" jobStatus="running" />);
    await flushAsyncWork();

    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(refreshMock).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(refreshMock).toHaveBeenCalledTimes(4);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(refreshMock).toHaveBeenCalledTimes(5);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("triggers the same recovery path when the browser job row completes first", async () => {
    browserSnapshot.job = {
      data: { status: "completed", progress: 100 },
      error: null,
    };

    render(<RunStatusPoller runId="run-1" status="running" jobStatus="running" />);
    await flushAsyncWork();

    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("reloads once if browser status is terminal but server props stay active", async () => {
    browserSnapshot.job = {
      data: { status: "failed", progress: 100 },
      error: null,
    };

    render(<RunStatusPoller runId="run-1" status="running" jobStatus="running" />);
    await flushAsyncWork();

    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(reloadMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the reload fallback once server props converge to terminal", async () => {
    browserSnapshot.run = {
      data: { id: "run-1", status: "completed" },
      error: null,
    };

    const { rerender } = render(
      <RunStatusPoller runId="run-1" status="running" jobStatus="running" />
    );
    await flushAsyncWork();

    rerender(<RunStatusPoller runId="run-1" status="completed" jobStatus="completed" />);
    await flushAsyncWork();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not burst-refresh or reload historical terminal runs on first mount", async () => {
    render(<RunStatusPoller runId="run-1" status="completed" jobStatus="completed" />);
    await flushAsyncWork();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(refreshMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not start duplicate burst loops across terminal rerenders", async () => {
    const { rerender } = render(
      <RunStatusPoller runId="run-1" status="running" jobStatus="running" />
    );
    await flushAsyncWork();

    rerender(<RunStatusPoller runId="run-1" status="completed" jobStatus="completed" />);
    await flushAsyncWork();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    rerender(<RunStatusPoller runId="run-1" status="completed" jobStatus="completed" />);
    await flushAsyncWork();

    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(refreshMock).toHaveBeenCalledTimes(4);
  });

  it("cleans up pending timers on unmount", async () => {
    browserSnapshot.run = {
      data: { id: "run-1", status: "completed" },
      error: null,
    };

    const { unmount } = render(
      <RunStatusPoller runId="run-1" status="running" jobStatus="running" />
    );
    await flushAsyncWork();

    unmount();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
