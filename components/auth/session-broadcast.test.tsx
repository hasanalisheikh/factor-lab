import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_VERIFICATION_SYNC_CHANNEL,
  EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
} from "@/lib/auth/email-verification-sync";
import { SessionBroadcast } from "./session-broadcast";

afterEach(cleanup);

const mockGetSession = vi.fn();
const mockChannelPostMessage = vi.fn();
const mockChannelClose = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
  }),
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
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockChannelPostMessage.mockReset();
    mockChannelClose.mockReset();
    window.localStorage.clear();
    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      writable: true,
      value: BroadcastChannelMock,
    });
  });

  it("publishes a cross-tab verification signal after hydrating the session", async () => {
    render(<SessionBroadcast />);

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(EMAIL_VERIFICATION_SYNC_STORAGE_KEY)).toEqual(
        expect.any(String)
      );
      expect(mockChannelPostMessage).toHaveBeenCalledTimes(1);
      expect(mockChannelClose).toHaveBeenCalledTimes(1);
    });

    expect(mockChannelPostMessage).toHaveBeenCalledWith(
      EMAIL_VERIFICATION_SYNC_CHANNEL,
      expect.any(String)
    );
    expect(mockChannelClose).toHaveBeenCalledWith(EMAIL_VERIFICATION_SYNC_CHANNEL);
  });
});
