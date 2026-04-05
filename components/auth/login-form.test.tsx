import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { EMAIL_VERIFICATION_SYNC_STORAGE_KEY } from "@/lib/auth/email-verification-sync";
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

const mockRouterReplace = vi.fn();
const mockRouterRefresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    refresh: mockRouterRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

// ---------------------------------------------------------------------------
// Mock the Supabase browser client so we control what getUser() returns
// ---------------------------------------------------------------------------
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockUnsubscribe = vi.fn();
const FIXED_SENT_AT = 1741305600000;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
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
    mockSearchParams = new URLSearchParams();
    mockGetUser.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockOnAuthStateChange.mockReset();
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: mockUnsubscribe,
        },
      },
    });
    mockUnsubscribe.mockReset();
    mockRouterReplace.mockReset();
    mockRouterRefresh.mockReset();
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

  it("6) verify tab redirects to dashboard when email verification completes in another tab", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    render(<LoginForm sessionUser={null} initialTab="verify" initialEmail="user@example.com" />);

    await waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
        newValue: JSON.stringify({ completedAt: Date.now() }),
      })
    );

    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("7) syncs to the verify tab and flow when the page rerenders with new search params", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { rerender } = render(<LoginForm sessionUser={null} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });

    mockSearchParams = new URLSearchParams("tab=verify&email=user%40example.com&flow=upgrade");
    rerender(<LoginForm sessionUser={null} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });

    expect(document.querySelector('input[name="flow"]')).toHaveAttribute("value", "upgrade");
  });

  it("8) proceeds to the dashboard if the verify tab finds an existing session", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    });

    render(<LoginForm sessionUser={null} initialTab="verify" initialEmail="user@example.com" />);

    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("9) leaves flow unset for legacy verify URLs so resend can use compatibility fallback", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    render(<LoginForm sessionUser={null} initialTab="verify" initialEmail="user@example.com" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    });

    expect(document.querySelector('input[name="flow"]')).toBeNull();
  });

  it("10) shows a resend countdown banner after a fresh verification email send", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_SENT_AT);

    try {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      render(
        <LoginForm
          sessionUser={null}
          initialTab="verify"
          initialEmail="user@example.com"
          initialFlow="signup"
          initialSentAt={FIXED_SENT_AT}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText("A verification email was sent recently. You can resend again in 60s.")
        ).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: "Resend again in 60s" })).toBeDisabled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
