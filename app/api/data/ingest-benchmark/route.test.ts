import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, createClientMock, triggerWorkerMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  triggerWorkerMock: vi.fn(),
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
import { DELETE, GET, POST } from "@/app/api/data/ingest-benchmark/route";

type QueryCall = [string, ...unknown[]];

function makeRequest(path: string) {
  return new NextRequest(`https://factorlab.test${path}`);
}

function makeJsonRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`https://factorlab.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockAuthenticatedUser(userId = "user-1") {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
  });
}

function makeDataIngestQuery(options: {
  calls: QueryCall[];
  rows?: Array<Record<string, unknown>>;
  error?: { message: string } | null;
}) {
  const query = {
    select(columns: string) {
      options.calls.push(["select", columns]);
      return query;
    },
    update(payload: Record<string, unknown>) {
      options.calls.push(["update", payload]);
      return query;
    },
    eq(column: string, value: unknown) {
      options.calls.push(["eq", column, value]);
      return query;
    },
    in(column: string, values: unknown[]) {
      options.calls.push(["in", column, values]);
      return Promise.resolve({ data: options.rows ?? [], error: options.error ?? null });
    },
    limit(limit: number) {
      options.calls.push(["limit", limit]);
      return Promise.resolve({ data: options.rows ?? [], error: options.error ?? null });
    },
  };

  return query;
}

function mockAdminDataIngest(options: {
  rows?: Array<Record<string, unknown>>;
  error?: { message: string } | null;
}) {
  const calls: QueryCall[] = [];
  const query = makeDataIngestQuery({ calls, rows: options.rows, error: options.error });
  createAdminClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      calls.push(["from", table]);
      return query;
    }),
  });
  return calls;
}

function mockAdminDataIngestWithLinkedRun(options: {
  jobOwnerUserId: string | null;
  calls: QueryCall[];
}) {
  const dataIngestQuery = makeDataIngestQuery({
    calls: options.calls,
    rows: [
      {
        id: "job-1",
        symbol: "SPY",
        status: "queued",
        requested_by_user_id: null,
        requested_by_run_id: "run-1",
        error: null,
      },
    ],
  });

  const runQuery = {
    select(columns: string) {
      options.calls.push(["runs.select", columns]);
      return runQuery;
    },
    eq(column: string, value: unknown) {
      options.calls.push(["runs.eq", column, value]);
      return runQuery;
    },
    maybeSingle() {
      options.calls.push(["runs.maybeSingle"]);
      return Promise.resolve({
        data: options.jobOwnerUserId ? { user_id: options.jobOwnerUserId } : null,
        error: null,
      });
    },
  };

  createAdminClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      options.calls.push(["from", table]);
      if (table === "data_ingest_jobs") return dataIngestQuery;
      if (table === "runs") return runQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  });
}

describe("/api/data/ingest-benchmark authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedUser();
  });

  it("does not expose another user's ingest job status", async () => {
    mockAdminDataIngest({
      rows: [
        {
          id: "job-1",
          symbol: "SPY",
          status: "queued",
          requested_by_user_id: "user-2",
          requested_by_run_id: null,
          error: null,
        },
      ],
    });

    const response = await GET(makeRequest("/api/data/ingest-benchmark?jobId=job-1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found." });
  });

  it("does not cancel another user's ingest job by id", async () => {
    mockAdminDataIngest({
      rows: [
        {
          id: "job-1",
          symbol: "SPY",
          status: "queued",
          requested_by_user_id: "user-2",
          requested_by_run_id: null,
          error: null,
        },
      ],
    });

    const response = await DELETE(makeRequest("/api/data/ingest-benchmark?jobId=job-1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found." });
  });

  it("exposes linked-run ingest jobs only to the run owner", async () => {
    const calls: QueryCall[] = [];
    mockAdminDataIngestWithLinkedRun({ jobOwnerUserId: "user-1", calls });

    const response = await GET(makeRequest("/api/data/ingest-benchmark?jobId=job-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "job-1",
      error_message: null,
    });
    expect(calls).toContainEqual(["runs.eq", "id", "run-1"]);
  });

  it("does not expose linked-run ingest jobs to other users", async () => {
    const calls: QueryCall[] = [];
    mockAdminDataIngestWithLinkedRun({ jobOwnerUserId: "user-2", calls });

    const response = await GET(makeRequest("/api/data/ingest-benchmark?jobId=job-1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found." });
    expect(calls).toContainEqual(["runs.eq", "id", "run-1"]);
  });

  it("scopes bulk cancellation to the authenticated user's ingest jobs", async () => {
    const calls = mockAdminDataIngest({ rows: [] });

    const response = await DELETE(makeRequest("/api/data/ingest-benchmark?cancelAll=1"));

    expect(response.status).toBe(200);
    expect(calls).toContainEqual(["eq", "requested_by_user_id", "user-1"]);
  });

  it("does not reuse or mutate another user's active ingest job during creation", async () => {
    const calls: QueryCall[] = [];

    const dataStateQuery = {
      select(columns: string) {
        calls.push(["data_state.select", columns]);
        return dataStateQuery;
      },
      eq(column: string, value: unknown) {
        calls.push(["data_state.eq", column, value]);
        return dataStateQuery;
      },
      maybeSingle() {
        calls.push(["data_state.maybeSingle"]);
        return Promise.resolve({ data: { data_cutoff_date: "2026-04-09" }, error: null });
      },
    };

    const activeJobsQuery = {
      select(columns: string) {
        calls.push(["data_ingest_jobs.select", columns]);
        return activeJobsQuery;
      },
      update(payload: Record<string, unknown>) {
        calls.push(["data_ingest_jobs.update", payload]);
        return activeJobsQuery;
      },
      eq(column: string, value: unknown) {
        calls.push(["data_ingest_jobs.eq", column, value]);
        if (column === "id") {
          return Promise.resolve({ data: null, error: null });
        }
        return activeJobsQuery;
      },
      in(column: string, values: unknown[]) {
        calls.push(["data_ingest_jobs.in", column, values]);
        return activeJobsQuery;
      },
      order(column: string, options: unknown) {
        calls.push(["data_ingest_jobs.order", column, options]);
        return activeJobsQuery;
      },
      limit(limit: number) {
        calls.push(["data_ingest_jobs.limit", limit]);
        return Promise.resolve({
          data: [
            {
              id: "other-job",
              symbol: "SPY",
              status: "queued",
              requested_by_user_id: "user-2",
              requested_by_run_id: null,
              error: null,
            },
          ],
          error: null,
        });
      },
    };

    const insertQuery = {
      insert(payload: Record<string, unknown>) {
        calls.push(["data_ingest_jobs.insert", payload]);
        return insertQuery;
      },
      select(columns: string) {
        calls.push(["data_ingest_jobs.insert.select", columns]);
        return insertQuery;
      },
      single() {
        calls.push(["data_ingest_jobs.insert.single"]);
        return Promise.resolve({ data: { id: "new-job" }, error: null });
      },
    };

    let dataIngestFromCount = 0;
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        calls.push(["from", table]);
        if (table === "data_state") return dataStateQuery;
        if (table === "data_ingest_jobs") {
          dataIngestFromCount += 1;
          return dataIngestFromCount === 1 ? activeJobsQuery : insertQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const response = await POST(
      makeJsonRequest("/api/data/ingest-benchmark", {
        ticker: "SPY",
        force_start_date: "2026-04-01",
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ jobId: "new-job" });
    expect(calls).toContainEqual([
      "data_ingest_jobs.insert",
      expect.objectContaining({
        requested_by_user_id: "user-1",
        symbol: "SPY",
      }),
    ]);
    expect(calls).not.toContainEqual(["data_ingest_jobs.eq", "id", "other-job"]);
  });
});
