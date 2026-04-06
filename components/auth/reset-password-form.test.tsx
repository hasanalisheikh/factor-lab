import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_SENT_AT = 1741305600000;

const {
  mockUseActionState,
  mockHydrateBrowserSession,
  mockFinalizePasswordResetSession,
  mockBroadcastPasswordResetComplete,
  mockForgotPasswordAction,
  mockResetPasswordAction,
  mockRouterReplace,
} = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
  mockHydrateBrowserSession: vi.fn(),
  mockFinalizePasswordResetSession: vi.fn(),
  mockBroadcastPasswordResetComplete: vi.fn(),
  mockForgotPasswordAction: vi.fn(),
  mockResetPasswordAction: vi.fn(),
  mockRouterReplace: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: mockUseActionState,
  };
});

vi.mock("@/app/actions/auth", () => ({
  forgotPasswordAction: mockForgotPasswordAction,
  resetPasswordAction: mockResetPasswordAction,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/reset-password",
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/client-session-hydration", () => ({
  hydrateBrowserSession: mockHydrateBrowserSession,
}));

vi.mock("@/lib/auth/password-reset-session", () => ({
  finalizePasswordResetSession: mockFinalizePasswordResetSession,
}));

vi.mock("@/lib/auth/password-reset-sync", () => ({
  broadcastPasswordResetComplete: mockBroadcastPasswordResetComplete,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn(),
    },
  }),
}));

import { ResetPasswordForm } from "./reset-password-form";

afterEach(cleanup);

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    mockUseActionState.mockReset();
    mockHydrateBrowserSession.mockReset();
    mockFinalizePasswordResetSession.mockReset();
    mockBroadcastPasswordResetComplete.mockReset();
    mockRouterReplace.mockReset();
    mockUseActionState.mockImplementation((action) =>
      action === mockResetPasswordAction || action === mockForgotPasswordAction
        ? [null, vi.fn(), false]
        : [null, vi.fn(), false]
    );
    mockHydrateBrowserSession.mockResolvedValue({
      status: "authenticated",
      error: null,
    });
    mockFinalizePasswordResetSession.mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally never resolves so the UI proves it does not block on cleanup.
        })
    );
  });

  it("shows success immediately after the password update without a finishing spinner", async () => {
    mockUseActionState.mockImplementation((action) =>
      action === mockResetPasswordAction
        ? [{ success: true }, vi.fn(), false]
        : [null, vi.fn(), false]
    );

    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(screen.getByText(/Password reset successful\. Close this tab/i)).toBeInTheDocument();
    });

    expect(screen.queryByText("Finishing password reset...")).not.toBeInTheDocument();
    expect(mockBroadcastPasswordResetComplete).toHaveBeenCalledTimes(1);
    expect(mockFinalizePasswordResetSession).toHaveBeenCalledTimes(1);
  });

  it("shows resend reset email controls on the expired reset-link screen", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_SENT_AT);

    try {
      mockUseActionState.mockImplementation((action) =>
        action === mockResetPasswordAction || action === mockForgotPasswordAction
          ? [null, vi.fn(), false]
          : [null, vi.fn(), false]
      );
      mockHydrateBrowserSession.mockResolvedValue({
        status: "failed",
        error: "Reset link expired. Please request a new password reset email.",
      });

      render(<ResetPasswordForm initialEmail="user@example.com" initialSentAt={FIXED_SENT_AT} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Resend again in 60s" })).toBeDisabled();
        expect(
          screen.getByText("A password reset email was sent recently. You can resend again in 60s.")
        ).toBeInTheDocument();
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
