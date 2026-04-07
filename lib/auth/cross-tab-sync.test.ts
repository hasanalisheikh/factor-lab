import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
  subscribeToEmailVerificationComplete,
} from "@/lib/auth/email-verification-sync";
import {
  PASSWORD_RESET_SYNC_STORAGE_KEY,
  subscribeToPasswordResetComplete,
} from "@/lib/auth/password-reset-sync";

describe("cross-tab auth sync helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores stale email verification markers but recovers from a fresh marker on focus", () => {
    window.localStorage.setItem(
      EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
      JSON.stringify({ completedAt: 50 })
    );
    vi.spyOn(Date, "now").mockReturnValue(100);
    const onComplete = vi.fn();

    const unsubscribe = subscribeToEmailVerificationComplete(onComplete);

    window.dispatchEvent(new Event("focus"));
    expect(onComplete).not.toHaveBeenCalled();

    window.localStorage.setItem(
      EMAIL_VERIFICATION_SYNC_STORAGE_KEY,
      JSON.stringify({ completedAt: 150 })
    );
    window.dispatchEvent(new Event("focus"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("ignores stale password reset markers but recovers from a fresh marker on focus", () => {
    window.localStorage.setItem(
      PASSWORD_RESET_SYNC_STORAGE_KEY,
      JSON.stringify({ completedAt: 50 })
    );
    vi.spyOn(Date, "now").mockReturnValue(100);
    const onComplete = vi.fn();

    const unsubscribe = subscribeToPasswordResetComplete(onComplete);

    window.dispatchEvent(new Event("focus"));
    expect(onComplete).not.toHaveBeenCalled();

    window.localStorage.setItem(
      PASSWORD_RESET_SYNC_STORAGE_KEY,
      JSON.stringify({ completedAt: 150 })
    );
    window.dispatchEvent(new Event("focus"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
