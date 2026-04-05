import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateBrowserSession } from "@/lib/auth/client-session-hydration";

describe("hydrateBrowserSession", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/auth/verified?verified=1");
    vi.restoreAllMocks();
  });

  it("hydrates a session from URL hash tokens and clears the hash", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/verified?verified=1#access_token=access-token&refresh_token=refresh-token"
    );

    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const supabase = {
      auth: {
        setSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "access-token" } },
          error: null,
        }),
        getSession: vi.fn(),
      },
    } as never;

    const result = await hydrateBrowserSession(supabase);

    expect(result).toEqual({ status: "authenticated", error: null });
    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/auth/verified?verified=1");
  });

  it("accepts an existing cookie-backed session when no hash is present", async () => {
    const supabase = {
      auth: {
        setSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "cookie-session" } },
          error: null,
        }),
      },
    } as never;

    const result = await hydrateBrowserSession(supabase);

    expect(result).toEqual({ status: "authenticated", error: null });
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("returns a failed state when no session can be established", async () => {
    const supabase = {
      auth: {
        setSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      },
    } as never;

    const result = await hydrateBrowserSession(supabase, "Verification link expired.");

    expect(result).toEqual({
      status: "failed",
      error: "Verification link expired.",
    });
  });
});
