import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { getRunsList } from "@/lib/supabase/queries";

describe("getRunsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches filtered runs once for the authenticated user with a bounded limit", async () => {
    const calls: Array<[string, unknown]> = [];
    const limitCalls: number[] = [];

    const query = {
      eq(column: string, value: unknown) {
        calls.push([`eq:${column}`, value]);
        return query;
      },
      ilike(column: string, value: unknown) {
        calls.push([`ilike:${column}`, value]);
        return query;
      },
      limit(limit: number) {
        limitCalls.push(limit);
        return Promise.resolve({
          data: [
            {
              id: "run-1",
              name: "Momentum sleeve",
              status: "completed",
              run_metrics: [],
            },
          ],
          count: 1,
          error: null,
        });
      },
      order(column: string, value: unknown) {
        calls.push([`order:${column}`, value]);
        return query;
      },
      select(columns: string, options: unknown) {
        calls.push(["select", { columns, options }]);
        return query;
      },
    };

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        calls.push(["from", table]);
        return query;
      }),
    };

    createClientMock.mockResolvedValue(client);

    const result = await getRunsList({
      limit: 500,
      search: "momentum",
      status: "completed",
    });

    expect(result.total).toBe(1);
    expect(result.runs).toHaveLength(1);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(calls).toContainEqual(["from", "runs"]);
    expect(calls).toContainEqual(["eq:user_id", "user-1"]);
    expect(calls).toContainEqual(["eq:status", "completed"]);
    expect(calls).toContainEqual(["ilike:name", "%momentum%"]);
    expect(limitCalls).toEqual([100]);
  });
});
