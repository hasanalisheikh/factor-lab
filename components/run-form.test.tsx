import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RunForm } from "@/components/run-form"

vi.mock("@/app/actions/runs", () => ({
  createRun: vi.fn(),
  ensureUniverseDataReady: vi.fn(),
  getUniverseBatchStatusAction: vi.fn(),
  preflightRun: vi.fn(),
  retryPreflightRepairs: vi.fn(),
}))

describe("RunForm", () => {
  it("shows the earliest valid start when the universe is ready", () => {
    render(
      <RunForm
        defaults={null}
        dataCoverage={{ minDateStr: "2010-01-01", maxDateStr: "2026-03-12" }}
        initialUniverseState={{
          ready: true,
          batchId: null,
          queuedSymbols: [],
          widenedSymbols: [],
          activeSymbols: [],
          failedSymbols: [],
          constraints: {
            universe: "ETF8",
            universeEarliestStart: "2004-11-18",
            universeValidFrom: "2004-11-18",
            missingTickers: [],
            ingestedCount: 8,
            totalCount: 8,
            ready: true,
            dataCutoffDate: "2026-03-12",
          },
        }}
      />
    )

    expect(
      screen.getByText(/Earliest valid start for this universe:/)
    ).toBeInTheDocument()
    expect(screen.getByText("2004-11-18")).toBeInTheDocument()
  })

  it("disables queueing while the universe still has missing tickers", () => {
    render(
      <RunForm
        defaults={null}
        dataCoverage={{ minDateStr: "2010-01-01", maxDateStr: "2026-03-12" }}
        initialUniverseState={{
          ready: false,
          batchId: null,
          queuedSymbols: [],
          widenedSymbols: [],
          activeSymbols: [],
          failedSymbols: [],
          constraints: {
            universe: "ETF8",
            universeEarliestStart: null,
            universeValidFrom: null,
            missingTickers: ["GLD"],
            ingestedCount: 7,
            totalCount: 8,
            ready: false,
            dataCutoffDate: "2026-03-12",
          },
        }}
      />
    )

    expect(screen.getByText(/Missing tickers: GLD/)).toBeInTheDocument()
    const queueButtons = screen.getAllByRole("button", { name: /Queue Backtest/i })
    expect(queueButtons[0]).toBeDisabled()
  })
})
