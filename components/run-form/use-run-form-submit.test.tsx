import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRunFormSubmit } from "./use-run-form-submit";

import type { FormEvent, RefObject } from "react";

const actionMocks = vi.hoisted(() => ({
  createRunMock: vi.fn(),
  preflightRunMock: vi.fn(),
  retryPreflightRepairsMock: vi.fn(),
}));

vi.mock("@/app/actions/runs", () => ({
  createRun: actionMocks.createRunMock,
  preflightRun: actionMocks.preflightRunMock,
  retryPreflightRepairs: actionMocks.retryPreflightRepairsMock,
}));

function makeFormRef(): RefObject<HTMLFormElement> {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="name" value="Fast run" />
    <select name="strategy_id"><option value="equal_weight" selected>Equal Weight</option></select>
    <input name="costs_bps" value="10" />
    <input name="slippage_bps" value="0" />
  `;
  return { current: form };
}

describe("useRunFormSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.createRunMock.mockResolvedValue({ ok: true, runId: "run-1" });
    actionMocks.preflightRunMock.mockResolvedValue({ status: "pass" });
  });

  it("submits through createRun without duplicating the server preflight", async () => {
    const router = { push: vi.fn() };
    const { result } = renderHook(() =>
      useRunFormSubmit({
        applyCosts: true,
        benchmark: "SPY",
        capitalValue: 100000,
        endDate: new Date("2026-03-12T00:00:00Z"),
        formRef: makeFormRef(),
        loadUniverseState: vi.fn(),
        router,
        setBenchmark: vi.fn(),
        setDateAdjustmentMessage: vi.fn(),
        setEndDate: vi.fn(),
        setStartDate: vi.fn(),
        setTopNValue: vi.fn(),
        startDate: new Date("2018-01-01T00:00:00Z"),
        topNValue: "5",
        universe: "ETF8",
        universeState: {
          ready: true,
          batchId: null,
          queuedSymbols: [],
          widenedSymbols: [],
          activeSymbols: [],
          failedSymbols: [],
          constraints: {
            dataCutoffDate: "2026-03-12",
            ingestedCount: 8,
            missingTickers: [],
            ready: true,
            totalCount: 8,
            universe: "ETF8",
            universeEarliestStart: "2004-11-18",
            universeValidFrom: "2004-11-18",
          },
        },
      })
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLFormElement>);
    });

    expect(actionMocks.preflightRunMock).not.toHaveBeenCalled();
    expect(actionMocks.createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledge_warnings: false,
        benchmark: "SPY",
        name: "Fast run",
        strategy_id: "equal_weight",
        universe: "ETF8",
      })
    );
    expect(router.push).toHaveBeenCalledWith("/runs/run-1");
  });
});
