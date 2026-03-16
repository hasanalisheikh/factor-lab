import { beforeEach, describe, expect, it, vi } from "vitest"

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
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock("@/lib/supabase/rate-limit", () => ({
  checkAccountCreationRateLimit: checkAccountCreationRateLimitMock,
  checkResendRateLimit: checkResendRateLimitMock,
}))

import { signUpAction, upgradeGuestToEmailPassword } from "@/app/actions/auth"

function makeGuestUser() {
  return {
    id: "guest-user-id",
    email: "guest_guest-user-id@factorlab.local",
    user_metadata: {
      is_guest: true,
      guest_created_at: "2026-03-14T00:00:00.000Z",
    },
  }
}

function makeServerClient(options?: {
  user?: ReturnType<typeof makeGuestUser> | null
  refreshedUser?: {
    id: string
    email: string
    user_metadata: Record<string, unknown>
  } | null
  refreshError?: { message: string } | null
}) {
  const user = options?.user ?? makeGuestUser()
  const refreshedUser = options?.refreshedUser ?? {
    id: "guest-user-id",
    email: "user@example.com",
    user_metadata: {
      ...(user?.user_metadata ?? {}),
      is_guest: false,
    },
  }

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
    },
  }
}

function makeAdminClient(options?: {
  existingUsers?: Array<{
    id: string
    email: string | null
  }>
  updateError?: { message: string } | null
}) {
  return {
    auth: {
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
  }
}

describe("guest account upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "127.0.0.1",
        origin: "http://localhost:3000",
      })
    )
    checkAccountCreationRateLimitMock.mockResolvedValue({ allowed: true })
    checkResendRateLimitMock.mockResolvedValue({ allowed: true })
  })

  it("updates the current guest user in place and redirects to the dashboard", async () => {
    const serverClient = makeServerClient()
    const adminClient = makeAdminClient()

    createClientMock.mockResolvedValue(serverClient)
    createAdminClientMock.mockReturnValue(adminClient)

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).rejects.toThrow("REDIRECT:/dashboard")

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
    )
    expect(serverClient.auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(serverClient.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it("reauthenticates with the upgraded credentials when refresh returns stale guest metadata", async () => {
    const serverClient = makeServerClient({
      refreshedUser: {
        id: "guest-user-id",
        email: "user@example.com",
        user_metadata: {
          is_guest: true,
        },
      },
    })
    const adminClient = makeAdminClient()

    createClientMock.mockResolvedValue(serverClient)
    createAdminClientMock.mockReturnValue(adminClient)

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).rejects.toThrow("REDIRECT:/dashboard")

    expect(serverClient.auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(serverClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password!",
    })
  })

  it("returns a friendly error when the email already belongs to another account", async () => {
    const serverClient = makeServerClient()
    const adminClient = makeAdminClient({
      existingUsers: [
        {
          id: "real-user-id",
          email: "user@example.com",
        },
      ],
    })

    createClientMock.mockResolvedValue(serverClient)
    createAdminClientMock.mockReturnValue(adminClient)

    await expect(
      upgradeGuestToEmailPassword({
        email: "user@example.com",
        password: "Password!",
      })
    ).resolves.toEqual({
      error: "An account with this email already exists. Sign in to that account instead.",
    })

    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(serverClient.auth.refreshSession).not.toHaveBeenCalled()
    expect(serverClient.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("routes guest sign-up submissions through the in-place upgrade flow", async () => {
    const serverClient = makeServerClient()
    const adminClient = makeAdminClient()

    createClientMock.mockResolvedValue(serverClient)
    createAdminClientMock.mockReturnValue(adminClient)

    const formData = new FormData()
    formData.set("email", "user@example.com")
    formData.set("password", "Password!")

    await expect(signUpAction(null, formData)).rejects.toThrow("REDIRECT:/dashboard")

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
      "guest-user-id",
      expect.objectContaining({
        email: "user@example.com",
        password: "Password!",
      })
    )
    expect(serverClient.auth.signUp).not.toHaveBeenCalled()
  })
})
