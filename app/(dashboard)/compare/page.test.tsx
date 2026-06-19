import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

const { getCompareRunBundlesMock } = vi.hoisted(() => ({
  getCompareRunBundlesMock: vi.fn(),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("@/components/compare/compare-workbench", () => ({
  CompareWorkbench: ({ bundles }: { bundles: unknown[] }) => (
    <div>Compare bundles: {bundles.length}</div>
  ),
}));

vi.mock("@/lib/supabase/queries", () => ({
  getCompareRunBundles: getCompareRunBundlesMock,
}));

import ComparePage from "@/app/(dashboard)/compare/page";

describe("ComparePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompareRunBundlesMock.mockResolvedValue([
      { run: { id: "run-a" } },
      { run: { id: "run-b" } },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("loads only the initially selected compare runs", async () => {
    render(await ComparePage());

    expect(screen.getByText("Compare bundles: 2")).toBeInTheDocument();
    expect(getCompareRunBundlesMock).toHaveBeenCalledWith(2);
  });
});
