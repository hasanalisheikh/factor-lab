import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWorkerTriggerEndpoint,
  summarizeResponseBody,
  triggerWorker,
} from "@/lib/worker-trigger";

const ORIGINAL_ENV = { ...process.env };

describe("worker-trigger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("appends /trigger for non-GitHub base URLs", () => {
    expect(resolveWorkerTriggerEndpoint("https://worker.example.com")).toBe(
      "https://worker.example.com/trigger"
    );
    expect(resolveWorkerTriggerEndpoint("https://worker.example.com/")).toBe(
      "https://worker.example.com/trigger"
    );
  });

  it("keeps GitHub dispatch URLs and explicit trigger URLs unchanged", () => {
    expect(
      resolveWorkerTriggerEndpoint("https://api.github.com/repos/acme/project/dispatches")
    ).toBe("https://api.github.com/repos/acme/project/dispatches");
    expect(resolveWorkerTriggerEndpoint("https://worker.example.com/trigger")).toBe(
      "https://worker.example.com/trigger"
    );
  });

  it("logs non-2xx responses with a short response body", async () => {
    process.env.WORKER_TRIGGER_URL = "https://worker.example.com";
    process.env.WORKER_TRIGGER_SECRET = "secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream failed\nwith details", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await triggerWorker("test.non_ok");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      })
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[worker-trigger:test.non_ok] failed status=503 endpoint=https://worker.example.com/trigger body=upstream failed with details"
      )
    );
  });

  it("logs network errors", async () => {
    process.env.WORKER_TRIGGER_URL = "https://api.github.com/repos/acme/project/dispatches";

    const boom = new Error("network down");
    const fetchMock = vi.fn().mockRejectedValue(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await triggerWorker("test.network_error");

    expect(errorSpy).toHaveBeenCalledWith(
      "[worker-trigger:test.network_error] request error endpoint=https://api.github.com/repos/acme/project/dispatches",
      boom
    );
  });

  it("normalizes empty response bodies to a compact marker", () => {
    expect(summarizeResponseBody("   \n\t  ")).toBe("<empty>");
  });
});
