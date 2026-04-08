import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock,
  }),
}));

import { RunStatusPoller } from "@/components/run-detail/run-status-poller";

describe("RunStatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls active runs on the base cadence", () => {
    render(<RunStatusPoller status="running" jobStatus="running" />);

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("schedules a bounded trailing burst when the run becomes terminal", () => {
    const { rerender } = render(<RunStatusPoller status="running" jobStatus="running" />);

    rerender(<RunStatusPoller status="completed" jobStatus="completed" />);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(4);
  });

  it("keeps the base loop running when the job is terminal but the run is still active", () => {
    const { rerender } = render(<RunStatusPoller status="running" jobStatus="running" />);

    rerender(<RunStatusPoller status="running" jobStatus="completed" />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(refreshMock).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(refreshMock).toHaveBeenCalledTimes(4);
  });

  it("does not burst-refresh historical terminal runs on first mount", () => {
    render(<RunStatusPoller status="completed" jobStatus="completed" />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not start duplicate burst loops across terminal rerenders", () => {
    const { rerender } = render(<RunStatusPoller status="running" jobStatus="running" />);

    rerender(<RunStatusPoller status="completed" jobStatus="completed" />);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    rerender(<RunStatusPoller status="completed" jobStatus="completed" />);

    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(refreshMock).toHaveBeenCalledTimes(4);
  });

  it("cleans up pending timers on unmount", () => {
    const { rerender, unmount } = render(<RunStatusPoller status="running" jobStatus="running" />);

    rerender(<RunStatusPoller status="completed" jobStatus="completed" />);
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
