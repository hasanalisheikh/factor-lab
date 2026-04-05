import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_VERIFICATION_SYNC_CHANNEL,
  EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
} from "@/lib/auth/email-verification-sync";
import { SessionBroadcast } from "./session-broadcast";

afterEach(cleanup);

const { mockHydrateBrowserSession, mockChannelPostMessage, mockChannelClose } = vi.hoisted(() => ({
  mockHydrateBrowserSession: vi.fn(),
  mockChannelPostMessage: vi.fn(),
  mockChannelClose: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {} }),
}));

vi.mock("@/lib/auth/client-session-hydration", () => ({
  hydrateBrowserSession: mockHydrateBrowserSession,
}));

class BroadcastChannelMock {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  addEventListener() {}

  removeEventListener() {}

  postMessage(message: string) {
    mockChannelPostMessage(this.name, message);
  }

  close() {
    mockChannelClose(this.name);
  }
}

describe("SessionBroadcast", () => {
  beforeEach(() => {
    mockHydrateBrowserSession.mockReset();
    mockHydrateBrowserSession.mockResolvedValue({
      status: "authenticated",
      error: null,
    });
    mockChannelPostMessage.mockReset();
    mockChannelClose.mockReset();
    window.localStorage.clear();
    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      writable: true,
      value: BroadcastChannelMock,
    });
  });

  it("shows success UI and publishes a cross-tab verification signal after hydration", async () => {
    render(<SessionBroadcast />);

    await waitFor(() => {
      expect(mockHydrateBrowserSession).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(EMAIL_VERIFICATION_SYNC_STORAGE_KEY)).toEqual(
        expect.any(String)
      );
      expect(mockChannelPostMessage).toHaveBeenCalledTimes(1);
      expect(mockChannelClose).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("heading", { name: "Email Confirmed" })).toBeInTheDocument();
    });

    expect(mockChannelPostMessage).toHaveBeenCalledWith(
      EMAIL_VERIFICATION_SYNC_CHANNEL,
      expect.any(String)
    );
    expect(mockChannelClose).toHaveBeenCalledWith(EMAIL_VERIFICATION_SYNC_CHANNEL);
  });

  it("shows an actionable error state when session hydration fails", async () => {
    mockHydrateBrowserSession.mockResolvedValue({
      status: "failed",
      error: "Verification link expired.",
    });

    render(<SessionBroadcast />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "We couldn't finish your sign-in" })
      ).toBeInTheDocument();
      expect(screen.getByText("Verification link expired.")).toBeInTheDocument();
    });

    expect(window.localStorage.getItem(EMAIL_VERIFICATION_SYNC_STORAGE_KEY)).toBeNull();
    expect(mockChannelPostMessage).not.toHaveBeenCalled();
  });

  it("shows a pending state while verification is still being completed", async () => {
    let resolveHydration: ((value: { status: "authenticated"; error: null }) => void) | null = null;
    mockHydrateBrowserSession.mockReturnValue(
      new Promise((resolve) => {
        resolveHydration = resolve;
      })
    );

    render(<SessionBroadcast />);

    expect(screen.getByRole("heading", { name: "Finishing verification..." })).toBeInTheDocument();

    resolveHydration?.({ status: "authenticated", error: null });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Email Confirmed" })).toBeInTheDocument();
    });
  });
});
