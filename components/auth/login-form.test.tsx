import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { LoginForm } from "./login-form";

// ---------------------------------------------------------------------------
// Vitest doesn't set `globals: true`, so @testing-library/react cannot find
// `global.afterEach` to register its auto-cleanup. Add it explicitly.
// ---------------------------------------------------------------------------
afterEach(cleanup);

// ---------------------------------------------------------------------------
// Mock server actions (server-only; cannot run in jsdom)
// ---------------------------------------------------------------------------
vi.mock("@/app/actions/auth", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  upgradeGuestAction: vi.fn(),
  resendVerificationAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the Supabase browser client so we control what getUser() returns
// ---------------------------------------------------------------------------
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      setSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function guestUser() {
  return {
    id: "guest-123",
    email: "guest_abc@factorlab.local",
    user_metadata: { is_guest: true },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LoginForm guest-upgrade mode", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it("1) shows upgrade mode when a valid guest session is confirmed client-side", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: guestUser() },
      error: null,
    });

    render(<LoginForm sessionUser={{ isGuest: true, email: null }} initialTab="signup" />);

    // Wait for the async session-validation effect to settle.
    // With a valid guest the component stays in upgrade mode.
    await waitFor(() => {
      expect(screen.getAllByText("Create account and keep my runs").length).toBeGreaterThan(0);
    });

    // "Continue as Guest" must NOT appear (user already has a session)
    expect(screen.queryByText("Continue as Guest")).not.toBeInTheDocument();
  });

  it("2) resets to normal mode when getUser() returns a JWT-expired error", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "JWT expired", status: 401 },
    });

    render(<LoginForm sessionUser={{ isGuest: true, email: null }} initialTab="signup" />);

    // Wait for the effect to detect the invalid session and reset state.
    await waitFor(() => {
      expect(screen.queryByText("Create account and keep my runs")).not.toBeInTheDocument();
    });

    // Use heading role to distinguish the h1 from the "Sign in" link inside the hidden signup tab
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Continue as Guest")).toBeInTheDocument();
  });

  it("3) shows normal mode when sessionUser is null (signed-out user)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    render(<LoginForm sessionUser={null} />);

    // No guest session from the start; after effect settles, still normal mode.
    await waitFor(() => {
      expect(screen.getByText("Continue as Guest")).toBeInTheDocument();
    });

    expect(screen.queryByText("Create account and keep my runs")).not.toBeInTheDocument();
  });

  it("4) resets stale server prop (isGuest:true) when client session is invalid", async () => {
    // Server prop says guest (stale — from router cache), but getUser returns null
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    render(<LoginForm sessionUser={{ isGuest: true, email: null }} initialTab="signup" />);

    // Effect detects no valid session → component resets to normal mode.
    await waitFor(() => {
      expect(screen.queryByText("Create account and keep my runs")).not.toBeInTheDocument();
    });

    // heading role targets the h1, avoiding the "Sign in" link inside the hidden signup tab
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Continue as Guest")).toBeInTheDocument();
  });

  it("5) normal signed-out user can see and click Continue as Guest", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    render(<LoginForm sessionUser={null} />);

    const btn = await screen.findByRole("button", { name: /continue as guest/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});
