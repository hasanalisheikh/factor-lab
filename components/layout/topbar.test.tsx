import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "@/components/layout/topbar";

const { pathnameState } = vi.hoisted(() => ({
  pathnameState: { value: "/data" },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
}));

vi.mock("@/components/data/diagnostics-toggle", () => ({
  DiagnosticsToggle: () => <button type="button">Diagnostics</button>,
}));

vi.mock("@/components/layout/topbar-search", () => ({
  TopbarSearch: () => <div data-testid="topbar-search" />,
}));

vi.mock("@/components/layout/topbar-notifications", () => ({
  TopbarNotifications: () => <div data-testid="topbar-notifications" />,
}));

vi.mock("@/components/layout/topbar-user-menu", () => ({
  TopbarUserMenu: () => <div data-testid="topbar-user-menu" />,
}));

vi.mock("@/components/layout/mobile-nav", () => ({
  MobileNav: () => <div data-testid="mobile-nav" />,
}));

vi.mock("@/components/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("Topbar", () => {
  beforeEach(() => {
    pathnameState.value = "/data";
  });

  afterEach(() => {
    cleanup();
  });

  it("hides the data diagnostics toggle when the data page gate is off", () => {
    render(<Topbar title="Data" showDataDiagnosticsToggle={false} />);

    expect(screen.queryByRole("button", { name: "Diagnostics" })).not.toBeInTheDocument();
  });

  it("shows the data diagnostics toggle when the data page gate is on", () => {
    render(<Topbar title="Data" showDataDiagnosticsToggle />);

    expect(screen.getByRole("button", { name: "Diagnostics" })).toBeInTheDocument();
  });

  it("keeps the run-form diagnostics toggle visible", () => {
    pathnameState.value = "/runs/new";

    render(<Topbar title="New Run" showDataDiagnosticsToggle={false} />);

    expect(screen.getAllByRole("button", { name: "Diagnostics" })).toHaveLength(1);
  });
});
