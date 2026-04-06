import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_SENT_AT = 1741305600000;

let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

const {
  createClientMock,
  createAdminClientMock,
  checkAccountCreationRateLimitMock,
  checkResendRateLimitMock,
  headersMock,
  redirectMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  checkAccountCreationRateLimitMock: vi.fn(),
  checkResendRateLimitMock: vi.fn(),
  headersMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/supabase/rate-limit", () => ({
  checkAccountCreationRateLimit: checkAccountCreationRateLimitMock,
  checkResendRateLimit: checkResendRateLimitMock,
}));

import {
  forgotPasswordAction,
  resendVerificationAction,
  signUpAction,
  upgradeGuestToEmailPassword,
} from "@/app/actions/auth";

function makeGuestUser() {
  return {
    id: "guest-user-id",
    email: "guest_guest-user-id@factorlab.local",
    user_metadata: {
      is_guest: true,
      guest_created_at: "2026-03-14T00:00:00.000Z",
    },
  };
}

function makeServerClient(options?: {
  user?: ReturnType<typeof makeGuestUser> | null;
  refreshedUser?: {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
  } | null;
  refreshError?: { message: string } | null;
  resendError?: { message: string; status?: number } | null;
  resetPasswordError?: { message: string; status?: number; code?: string } | null;
}) {
  const user = options?.user === undefined ? makeGuestUser() : options.user;
  const refreshedUser = options?.refreshedUser ?? {
    id: "guest-user-id",
    email: "user@example.com",
    user_metadata: {
      ...(user?.user_metadata ?? {}),
      is_guest: false,
    },
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "session-token" },
          user: refreshedUser,
        },
        error: options?.refreshError ?? null,
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "session-token" },
          user: refreshedUser,
        },
        error: null,
      }),
      signUp: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "new-user-id",
            identities: [{ id: "identity-1" }],
          },
          session: { access_token: "session-token" },
        },
        error: null,
      }),
      resend: vi.fn().mockResolvedValue({
        data: {},
        error: options?.resendError ?? null,
      }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({
        data: {},
        error: options?.resetPasswordError ?? null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

function makeAdminClient(options?: {
  existingUsers?: Array<{
    id: string;
    email: string | null;
  }>;
  updateError?: { message: string } | null;
  otpError?: { message: string; status?: number } | null;
}) {
  return {
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: options?.otpError ?? null }),
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: {
            users: options?.existingUsers ?? [],
            aud: "authenticated",
            nextPage: null,
            lastPage: 1,
            total: options?.existingUsers?.length ?? 0,
          },
          error: null,
        }),
        updateUserById: vi.fn().mockResolvedValue({
          data: { user: { id: "guest-user-id" } },
          error: options?.updateError ?? null,
        }),
      },
    },
  };
}

describe("guest account upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dateNowSpy?.mockRestore();
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_SENT_AT);

    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        origin: "http://localhost:3000",
      })
    );
    checkAccountCreationRateLimitMock.mockResolvedValue({ allowed: true });
    checkResendRateLimitMock.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
  });

  it("upgrades guest in place, sends OTP magic-link, and redirects to verify", async () => {
    const serverClient = makeServerClient();
    const adminClient = makeAdminClient();

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(adminClient);

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).rejects.toThrow(
      "REDIRECT:/login?tab=verify&email=user%40example.com&flow=upgrade&sent_at=1741305600000"
    );

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
      "guest-user-id",
      expect.objectContaining({
        email: "user@example.com",
        password: "Password!",
        email_confirm: true,
        user_metadata: expect.objectContaining({
          is_guest: false,
          guest_created_at: "2026-03-14T00:00:00.000Z",
        }),
      })
    );
    expect(adminClient.auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        options: expect.objectContaining({ shouldCreateUser: false }),
      })
    );
    expect(serverClient.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("OTP failure is non-fatal: still signs out and redirects to verify page", async () => {
    const serverClient = makeServerClient();
    const adminClient = makeAdminClient({ otpError: { message: "rate limited" } });

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(adminClient);

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).rejects.toThrow("REDIRECT:/login?tab=verify&email=user%40example.com&flow=upgrade");

    expect(adminClient.auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(serverClient.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly error when the email already belongs to another account", async () => {
    const serverClient = makeServerClient();
    const adminClient = makeAdminClient({
      existingUsers: [
        {
          id: "real-user-id",
          email: "user@example.com",
        },
      ],
    });

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(adminClient);

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).resolves.toEqual({
      error: "An account with this email already exists. Sign in to that account instead.",
    });

    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(serverClient.auth.refreshSession).not.toHaveBeenCalled();
    expect(serverClient.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("routes guest sign-up submissions through the in-place upgrade flow", async () => {
    const serverClient = makeServerClient();
    const adminClient = makeAdminClient();

    createClientMock.mockResolvedValue(serverClient);
    createAdminClientMock.mockReturnValue(adminClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "Password!");

    await expect(signUpAction(null, formData)).rejects.toThrow(
      "REDIRECT:/login?tab=verify&email=user%40example.com&flow=upgrade&sent_at=1741305600000"
    );

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
      "guest-user-id",
      expect.objectContaining({
        email: "user@example.com",
        password: "Password!",
      })
    );
    expect(serverClient.auth.signUp).not.toHaveBeenCalled();
  });
});

describe("sign up verification flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dateNowSpy?.mockRestore();
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_SENT_AT);

    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        origin: "http://localhost:3000",
      })
    );
    checkAccountCreationRateLimitMock.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
  });

  it("redirects new signups to the verify tab with flow=signup", async () => {
    const serverClient = makeServerClient({ user: null });
    serverClient.auth.signUp.mockResolvedValue({
      data: {
        user: {
          id: "new-user-id",
          identities: [{ id: "identity-1" }],
        },
        session: null,
      },
      error: null,
    });

    createClientMock.mockResolvedValue(serverClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "Password!");

    await expect(signUpAction(null, formData)).rejects.toThrow(
      "REDIRECT:/login?tab=verify&email=user%40example.com&flow=signup&sent_at=1741305600000"
    );
  });

  it("builds signup verification links from forwarded deployment headers when origin is absent", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "factorlab.app",
        "x-forwarded-proto": "https",
      })
    );

    const serverClient = makeServerClient({ user: null });
    serverClient.auth.signUp.mockResolvedValue({
      data: {
        user: {
          id: "new-user-id",
          identities: [{ id: "identity-1" }],
        },
        session: null,
      },
      error: null,
    });

    createClientMock.mockResolvedValue(serverClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "Password!");

    await expect(signUpAction(null, formData)).rejects.toThrow(
      "REDIRECT:/login?tab=verify&email=user%40example.com&flow=signup&sent_at=1741305600000"
    );

    expect(serverClient.auth.signUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password!",
      options: {
        emailRedirectTo: "https://factorlab.app/auth/callback?signup_confirm=1",
      },
    });
  });
});

describe("forgot password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        origin: "http://localhost:3000",
      })
    );
  });

  it("builds password reset links from forwarded deployment headers when origin is absent", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "factorlab.app",
        "x-forwarded-proto": "https",
      })
    );

    const serverClient = makeServerClient({ user: null });
    createClientMock.mockResolvedValue(serverClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");

    await expect(forgotPasswordAction(null, formData)).resolves.toEqual({
      success: true,
    });

    expect(serverClient.auth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "https://factorlab.app/auth/callback?next=/reset-password",
    });
  });

  it("surfaces provider-side reset throttling with a user-friendly error", async () => {
    const serverClient = makeServerClient({
      user: null,
      resetPasswordError: {
        message: "email rate limit exceeded",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });
    createClientMock.mockResolvedValue(serverClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");

    await expect(forgotPasswordAction(null, formData)).resolves.toEqual({
      error:
        "We've sent too many password reset emails recently. Please try again later. Check your inbox and spam for the latest email.",
    });
  });
});

describe("resend verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dateNowSpy?.mockRestore();
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_SENT_AT);

    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        origin: "http://localhost:3000",
      })
    );
    checkAccountCreationRateLimitMock.mockResolvedValue({ allowed: true });
    checkResendRateLimitMock.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
  });

  it("uses the standard signup resend flow for unverified accounts", async () => {
    const adminClient = makeAdminClient();

    createAdminClientMock.mockReturnValue(adminClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("flow", "signup");

    await expect(resendVerificationAction(null, formData)).resolves.toEqual({
      success: true,
      cooldownSeconds: 60,
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/auth/callback?signup_confirm=1",
      },
    });
  });

  it("uses an activation magic link directly for guest-upgrade verification", async () => {
    const adminClient = makeAdminClient();

    createAdminClientMock.mockReturnValue(adminClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("flow", "upgrade");

    await expect(resendVerificationAction(null, formData)).resolves.toEqual({
      success: true,
      cooldownSeconds: 60,
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/auth/callback?activation=1",
      },
    });
  });

  it("builds resend and activation links from forwarded deployment headers when origin is absent", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "factorlab.app",
        "x-forwarded-proto": "https",
      })
    );

    const adminClient = makeAdminClient();

    createAdminClientMock.mockReturnValue(adminClient);

    const signupFormData = new FormData();
    signupFormData.set("email", "user@example.com");
    signupFormData.set("flow", "signup");

    await expect(resendVerificationAction(null, signupFormData)).resolves.toEqual({
      success: true,
      cooldownSeconds: 60,
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://factorlab.app/auth/callback?signup_confirm=1",
      },
    });

    const upgradeFormData = new FormData();
    upgradeFormData.set("email", "user@example.com");
    upgradeFormData.set("flow", "upgrade");

    await expect(resendVerificationAction(null, upgradeFormData)).resolves.toEqual({
      success: true,
      cooldownSeconds: 60,
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenNthCalledWith(2, {
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://factorlab.app/auth/callback?activation=1",
      },
    });
  });

  it("falls back to an activation magic link when legacy verify links omit flow", async () => {
    const adminClient = makeAdminClient();
    adminClient.auth.signInWithOtp
      .mockResolvedValueOnce({ error: { message: "Email is already confirmed" } })
      .mockResolvedValueOnce({ error: null });

    createAdminClientMock.mockReturnValue(adminClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");

    await expect(resendVerificationAction(null, formData)).resolves.toEqual({
      success: true,
      cooldownSeconds: 60,
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/auth/callback?signup_confirm=1",
      },
    });

    expect(adminClient.auth.signInWithOtp).toHaveBeenNthCalledWith(2, {
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/auth/callback?activation=1",
      },
    });
  });

  it("returns a cooldown state without attempting a resend when the local limiter blocks it", async () => {
    checkResendRateLimitMock.mockResolvedValue({
      allowed: false,
      error: "Please wait 42 seconds before requesting another verification email.",
      retryAfterSeconds: 42,
    });

    const formData = new FormData();
    formData.set("email", "user@example.com");

    await expect(resendVerificationAction(null, formData)).resolves.toEqual({
      rateLimited: true,
      cooldownSeconds: 42,
      message: "Please wait 42 seconds before requesting another verification email.",
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("surfaces provider-side resend throttling as a provider-limited state", async () => {
    const adminClient = makeAdminClient({
      otpError: {
        message: "For security purposes, you can only request this after 60 seconds.",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });

    createAdminClientMock.mockReturnValue(adminClient);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("flow", "signup");

    await expect(resendVerificationAction(null, formData)).resolves.toEqual({
      providerLimited: true,
      message:
        "We've sent too many verification emails recently. Please try again later. Check your inbox and spam for the latest email.",
    });
  });
});
