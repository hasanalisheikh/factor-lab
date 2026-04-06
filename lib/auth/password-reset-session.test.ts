import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSupabaseBrowserSession,
  finalizePasswordResetSession,
  getSupabaseAuthStorageKey,
} from "@/lib/auth/password-reset-session";

const STORAGE_KEY = "sb-factorlab-auth-token";

describe("password reset session cleanup", () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/reset-password");
    document.cookie = `${STORAGE_KEY}=session; path=/`;
    document.cookie = `${STORAGE_KEY}.0=session-part; path=/`;
    document.cookie = `${STORAGE_KEY}-code-verifier=verifier; path=/`;
    document.cookie = `${STORAGE_KEY}-user=user; path=/`;
    window.localStorage.setItem(STORAGE_KEY, "session");
    window.localStorage.setItem(`${STORAGE_KEY}-code-verifier`, "verifier");
    window.localStorage.setItem(`${STORAGE_KEY}-user`, "user");
  });

  it("derives the default auth storage key from the Supabase project ref", () => {
    expect(getSupabaseAuthStorageKey("https://quspsjupkgtdkxizhfek.supabase.co")).toBe(
      "sb-quspsjupkgtdkxizhfek-auth-token"
    );
  });

  it("clears cookie-backed and local auth storage", () => {
    const cleared = clearSupabaseBrowserSession(STORAGE_KEY);

    expect(cleared).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(`${STORAGE_KEY}-code-verifier`)).toBeNull();
    expect(window.localStorage.getItem(`${STORAGE_KEY}-user`)).toBeNull();
    expect(document.cookie).not.toContain(STORAGE_KEY);
  });

  it("clears browser auth storage immediately even if Supabase signOut never resolves", async () => {
    vi.useFakeTimers();

    const supabase = {
      auth: {
        signOut: vi.fn(
          () =>
            new Promise<{
              error: null;
            }>(() => {
              // Intentionally never resolves to simulate the browser auth lock hanging.
            })
        ),
      },
    } as never;

    const resultPromise = finalizePasswordResetSession(supabase, {
      storageKey: STORAGE_KEY,
      timeoutMs: 25,
    });

    await expect(resultPromise).resolves.toEqual({
      error: null,
      usedFallback: true,
    });

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(STORAGE_KEY);

    await vi.advanceTimersByTimeAsync(25);
  });
});
