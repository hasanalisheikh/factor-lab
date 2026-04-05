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
  beforeEach(() => {
    cookiesMock.mockReset();
    createServerClientMock.mockReset();
    cookiesMock.mockResolvedValue(makeCookieStore());
    createServerClientMock.mockReturnValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });
  });

  it("forwards signup-confirm hash callbacks back through /login with the verified destination", async () => {
    const response = await GET(
      new NextRequest("https://factorlab.test/auth/callback?signup_confirm=1")
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();

    expect(body).toContain("/login?next=%2Fauth%2Fverified%3Fverified%3D1");
  });
});
