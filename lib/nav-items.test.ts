import { describe, expect, it } from "vitest"
import { isNavItemActive, mainNavItems } from "@/lib/nav-items"

describe("isNavItemActive", () => {
  it("activates exact match item", () => {
    const item = mainNavItems.find((i) => i.href === "/runs/new")
    expect(item).toBeTruthy()
    expect(isNavItemActive(item!, "/runs/new", mainNavItems)).toBe(true)
  })

  it("activates parent runs route for child id path", () => {
    const runsItem = mainNavItems.find((i) => i.href === "/runs")
    expect(runsItem).toBeTruthy()
    expect(isNavItemActive(runsItem!, "/runs/123", mainNavItems)).toBe(true)
  })

  it("does not activate /runs when /runs/new is exact match", () => {
    const runsItem = mainNavItems.find((i) => i.href === "/runs")
    expect(runsItem).toBeTruthy()
    expect(isNavItemActive(runsItem!, "/runs/new", mainNavItems)).toBe(false)
  })
})
