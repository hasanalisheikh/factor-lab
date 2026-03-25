import { describe, expect, it } from "vitest";
import { isBenchmarkHeldAtLatestRebalance } from "@/lib/benchmark";

describe("isBenchmarkHeldAtLatestRebalance", () => {
  it("returns true when latest rebalance holds benchmark with positive weight", () => {
    const positions = [
      { date: "2025-01-31", symbol: "SPY", weight: 0.2 },
      { date: "2025-02-28", symbol: "SPY", weight: 0.1 },
      { date: "2025-02-28", symbol: "QQQ", weight: 0.3 },
    ];
    expect(isBenchmarkHeldAtLatestRebalance(positions, "SPY")).toBe(true);
  });

  it("returns false when latest rebalance does not hold benchmark", () => {
    const positions = [
      { date: "2025-01-31", symbol: "SPY", weight: 0.2 },
      { date: "2025-02-28", symbol: "SPY", weight: 0.0 },
      { date: "2025-02-28", symbol: "QQQ", weight: 0.3 },
    ];
    expect(isBenchmarkHeldAtLatestRebalance(positions, "SPY")).toBe(false);
  });
});
