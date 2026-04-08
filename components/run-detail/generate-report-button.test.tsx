import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPORT_URL = "https://reports.example/run-1/tearsheet.html";

const { formActionMock, generateRunReportMock, mockUseActionState, routerMock } = vi.hoisted(() => {
  const refreshMock = vi.fn();

  return {
    formActionMock: vi.fn(),
    generateRunReportMock: vi.fn(),
    mockUseActionState: vi.fn(),
    routerMock: {
      push: vi.fn(),
      replace: vi.fn(),
      refresh: refreshMock,
    },
  };
});

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: mockUseActionState,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/app/actions/reports", () => ({
  generateRunReport: generateRunReportMock,
}));

import { GenerateReportButton } from "@/components/run-detail/generate-report-button";

afterEach(cleanup);

describe("GenerateReportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActionState.mockReturnValue([null, formActionMock, false]);
  });

  it("shows Generate Report in the idle state", () => {
    render(<GenerateReportButton runId="run-1" />);

    expect(screen.getByRole("button", { name: "Generate Report" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Download Report" })).not.toBeInTheDocument();
  });

  it("shows a disabled Generating state while the action is pending", () => {
    mockUseActionState.mockReturnValue([null, formActionMock, true]);

    render(<GenerateReportButton runId="run-1" />);

    const button = screen.getByRole("button", { name: /Generating/i });
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("shows Download Report immediately when generation succeeds", async () => {
    mockUseActionState.mockReturnValue([
      { success: true, url: REPORT_URL },
      formActionMock,
      false,
    ]);

    render(<GenerateReportButton runId="run-1" />);

    const link = screen.getByRole("link", { name: "Download Report" });
    expect(link).toHaveAttribute("href", REPORT_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("button", { name: "Generate Report" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the inline error and keeps Generate Report available for retry", () => {
    mockUseActionState.mockReturnValue([
      { success: false, error: "Report generation failed." },
      formActionMock,
      false,
    ]);

    render(<GenerateReportButton runId="run-1" />);

    expect(screen.getByRole("button", { name: "Generate Report" })).toBeEnabled();
    expect(screen.getByText("Report generation failed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download Report" })).not.toBeInTheDocument();
  });

  it("triggers exactly one background refresh after success", async () => {
    mockUseActionState.mockReturnValue([
      { success: true, url: REPORT_URL },
      formActionMock,
      false,
    ]);

    const { rerender } = render(<GenerateReportButton runId="run-1" />);

    await waitFor(() => {
      expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    });

    rerender(<GenerateReportButton runId="run-1" />);

    await waitFor(() => {
      expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    });
  });
});
