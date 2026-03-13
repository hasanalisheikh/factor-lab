import { describe, expect, it } from "vitest"

import {
  downsampleEquityCurve,
  getAlignedTimeframeEquityCurve,
} from "@/lib/equity-curve"

function makePoint(index: number) {
  const date = new Date(Date.UTC(2023, 0, 1 + index))
  return {
    date: date.toISOString().slice(0, 10),
    portfolio: 100_000 + index,
    benchmark: 100_000 + index / 2,
  }
}

describe("downsampleEquityCurve", () => {
  it("always preserves the first and last visible dates", () => {
    const data = Array.from({ length: 1001 }, (_, index) => makePoint(index))

    const sampled = downsampleEquityCurve(data, 100)

    expect(sampled[0]?.date).toBe(data[0]?.date)
    expect(sampled.at(-1)?.date).toBe(data.at(-1)?.date)
  })
})

describe("getAlignedTimeframeEquityCurve", () => {
  it("keeps the full run range when ALL is selected", () => {
    const data = Array.from({ length: 500 }, (_, index) => makePoint(index))

    const allRange = getAlignedTimeframeEquityCurve(data, "ALL")

    expect(allRange).toHaveLength(data.length)
    expect(allRange[0]?.date).toBe(data[0]?.date)
    expect(allRange.at(-1)?.date).toBe(data.at(-1)?.date)
  })
})
