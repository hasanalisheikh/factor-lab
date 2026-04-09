import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const {
  buildScheduledRefreshWindowMock,
  createAdminClientMock,
  createClientMock,
  getLastCompleteTradingDayUtcMock,
  getRequiredTickersMock,
  isDailyUpdatesEnabledMock,
  triggerWorkerMock,
} = vi.hoisted(() => ({
  buildScheduledRefreshWindowMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  getLastCompleteTradingDayUtcMock: vi.fn(),
  getRequiredTickersMock: vi.fn(),
  isDailyUpdatesEnabledMock: vi.fn(),
  triggerWorkerMock: vi.fn(),
}));

vi.mock("@/lib/data-cutoff", () => ({
  buildScheduledRefreshWindow: buildScheduledRefreshWindowMock,
  getLastCompleteTradingDayUtc: getLastCompleteTradingDayUtcMock,
  getRequiredTickers: getRequiredTickersMock,
  isDailyUpdatesEnabled: isDailyUpdatesEnabledMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/worker-trigger", () => ({
  triggerWorker: triggerWorkerMock,
}));

import { NextRequest } from "next/server";
import { runScheduledRefresh } from "@/app/api/cron/_lib/refresh";

function makeRequest(options?: { authHeader?: string; cookie?: string }) {
  const headers = new Headers();
  if (options?.authHeader) headers.set("Authorization", options.authHeader);
  if (options?.cookie) headers.set("Cookie", options.cookie);
  return new NextRequest("https://factorlab.test/api/cron/daily-refresh", { headers });
}

describe("scheduled refresh authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };

    buildScheduledRefreshWindowMock.mockReturnValue({
      startDate: "2026-04-01",
      endDate: "2026-04-09",
    });
    getLastCompleteTradingDayUtcMock.mockReturnValue("2026-04-09");
    getRequiredTickersMock.mockReturnValue(["SPY"]);
    isDailyUpdatesEnabledMock.mockReturnValue(false);
    createAdminClientMock.mockImplementation(() => {
      throw new Error("createAdminClient should not be called in auth tests");
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("authorizes requests with the configured bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";

    const response = await runScheduledRefresh(
      makeRequest({ authHeader: "Bearer cron-secret" }),
      "daily"
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "daily_updates_disabled",
      mode: "daily",
      targetCutoffDate: "2026-04-09",
    });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });

  it("rejects requests without the bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";

    const response = await runScheduledRefresh(makeRequest(), "daily");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";

    const response = await runScheduledRefresh(
      makeRequest({ authHeader: "Bearer wrong-secret" }),
      "daily"
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });

  it("rejects authenticated user sessions without the cron bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "user@example.com",
              app_metadata: {},
            },
          },
        }),
      },
    });

    const response = await runScheduledRefresh(
      makeRequest({ cookie: "sb-session=authenticated-user" }),
      "daily"
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });

  it("rejects guest sessions without the cron bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "guest-1",
              email: "guest_guest-1@factorlab.local",
              user_metadata: {
                is_guest: true,
              },
            },
          },
        }),
      },
    });

    const response = await runScheduledRefresh(
      makeRequest({ cookie: "sb-session=guest-user" }),
      "daily"
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await runScheduledRefresh(
      makeRequest({ authHeader: "Bearer cron-secret" }),
      "daily"
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Cron secret not configured." });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(triggerWorkerMock).not.toHaveBeenCalled();
  });
});
