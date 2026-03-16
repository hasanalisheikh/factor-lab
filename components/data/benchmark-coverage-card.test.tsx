import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BenchmarkCoverageCard } from "./benchmark-coverage-card"
import type { BenchmarkCoverage } from "@/lib/supabase/types"

const diagnosticsState = vi.hoisted(() => ({ enabled: false }))
const toggleMock = vi.hoisted(() => vi.fn())

vi.mock("./diagnostics-toggle", () => ({
  useDiagnosticsMode: () => ({
    enabled: diagnosticsState.enabled,
    toggle: toggleMock,
  }),
}))

function makeCoverage(overrides: Partial<BenchmarkCoverage> = {}): BenchmarkCoverage {
  return {
    ticker: "SPY",
    actualDays: 100,
    expectedDays: 100,
    missingDays: 0,
    coveragePercent: 100,
    trueMissingRate: 0,
    windowStart: "2024-01-02",
    windowEnd: "2024-05-31",
    latestDate: "2024-05-31",
    earliestDate: "2010-01-04",
    needsHistoricalBackfill: false,
    status: "ok",
    ...overrides,
  }
}

function renderCard(coverage: BenchmarkCoverage, diagnosticsEnabled: boolean) {
  diagnosticsState.enabled = diagnosticsEnabled

  render(
    <BenchmarkCoverageCard
      benchmarks={[
        {
          ticker: coverage.ticker,
          coverage,
          initialJob: null,
        },
      ]}
    />
  )
}

describe("BenchmarkCoverageCard", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    diagnosticsState.enabled = false
    toggleMock.mockReset()
  })

  it("hides optional full-history actions when diagnostics is off", () => {
    renderCard(
      makeCoverage({
        needsHistoricalBackfill: true,
      }),
      false
    )

    expect(screen.queryByRole("button", { name: /^Backfill$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Backfill full history$/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Enable diagnostics")).not.toBeInTheDocument()
  })

  it("shows an optional full-history action for healthy rows in diagnostics mode", () => {
    renderCard(
      makeCoverage({
        needsHistoricalBackfill: true,
      }),
      true
    )

    const button = screen.getByRole("button", { name: "Backfill full history" })
    expect(button).toHaveAttribute("title", "Optional. Research window is already healthy.")
    expect(screen.queryByRole("button", { name: /^Backfill$/ })).not.toBeInTheDocument()
    expect(
      screen.getByText(/Research window coverage is already healthy\./)
    ).toBeInTheDocument()
  })

  it("shows a neutral up-to-date label for fully current healthy rows", () => {
    renderCard(makeCoverage(), true)

    expect(screen.getByText("Up to date")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Backfill$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Backfill full history$/ })).not.toBeInTheDocument()
  })

  it("keeps the backfill action for rows that are behind the cutoff date", () => {
    renderCard(
      makeCoverage({
        latestDate: "2024-05-30",
      }),
      true
    )

    expect(screen.getByRole("button", { name: "Backfill" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Backfill full history$/ })).not.toBeInTheDocument()
  })

  it("keeps the backfill action for rows with incomplete monitored-window coverage", () => {
    renderCard(
      makeCoverage({
        actualDays: 99,
        missingDays: 1,
        coveragePercent: 99,
        status: "partial",
      }),
      true
    )

    expect(screen.getByRole("button", { name: "Backfill" })).toBeInTheDocument()
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument()
  })
})
