import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, createServerClientMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

function makeCookieStore() {
  return {
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  };
}

describe("/auth/callback", () => {
  let mockVerifyOtp: ReturnType<typeof vi.fn>;
  let mockExchangeCodeForSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cookiesMock.mockReset();
    createServerClientMock.mockReset();
    cookiesMock.mockResolvedValue(makeCookieStore());
    mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });
    mockExchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    createServerClientMock.mockReturnValue({
      auth: {
        verifyOtp: mockVerifyOtp,
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    });
  });

  it("forwards signup-confirm hash callbacks back through /login with the verified destination", async () => {
    const response = await GET(
      new NextRequest("https://factorlab.test/auth/callback?signup_confirm=1")
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();

    expect(body).toContain("/auth/verified?verified=1");
    expect(body).not.toContain("/login?next=");
  });

  it("redirects code-based signup confirmations to the verified page", async () => {
    const response = await GET(
      new NextRequest("https://factorlab.test/auth/callback?code=pkce-code&signup_confirm=1")
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe(
      "https://factorlab.test/auth/verified?verified=1"
    );
  });

  it("redirects token-hash signup confirmations to the verified page", async () => {
    const response = await GET(
      new NextRequest("https://factorlab.test/auth/callback?token_hash=signup-token&type=signup")
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "signup-token",
      type: "signup",
    });
    expect(response.headers.get("location")).toBe(
      "https://factorlab.test/auth/verified?verified=1"
    );
  });

  it("keeps reset-password hash forwarding pointed at /reset-password", async () => {
    const response = await GET(
      new NextRequest("https://factorlab.test/auth/callback?next=/reset-password")
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();

    expect(body).toContain("https://factorlab.test/reset-password");
  });

  it("sends invalid verification links back to the verify tab", async () => {
    const response = await GET(
      new NextRequest(
        "https://factorlab.test/auth/callback?error=access_denied&error_description=Expired%20link"
      )
    );

    expect(response.headers.get("location")).toBe(
      "https://factorlab.test/login?tab=verify&error=Expired+link"
    );
  });
});
