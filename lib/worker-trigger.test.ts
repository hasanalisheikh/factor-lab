import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWorkerTriggerConfigurationError,
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
    process.env.WORKER_GITHUB_DISPATCH_TOKEN = "github-token";

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

  it("uses the GitHub dispatch token for repository dispatch endpoints", async () => {
    process.env.WORKER_TRIGGER_URL = "https://api.github.com/repos/acme/project/dispatches";
    process.env.WORKER_TRIGGER_SECRET = "worker-secret";
    process.env.WORKER_GITHUB_DISPATCH_TOKEN = "github-token";

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await triggerWorker("test.github_token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/project/dispatches",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-token",
        }),
      })
    );
  });

  it("does not call GitHub dispatch endpoints without a GitHub token", async () => {
    process.env.WORKER_TRIGGER_URL = "https://api.github.com/repos/acme/project/dispatches";
    process.env.WORKER_TRIGGER_SECRET = "worker-secret";

    const fetchMock = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerWorker("test.github_missing_token");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "missing_token",
      attempted: false,
      envName: "WORKER_GITHUB_DISPATCH_TOKEN",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[worker-trigger:test.github_missing_token] missing WORKER_GITHUB_DISPATCH_TOKEN for GitHub repository dispatch endpoint"
    );
  });

  it("describes the missing token for a configured trigger endpoint", () => {
    process.env.WORKER_TRIGGER_URL = "https://api.github.com/repos/acme/project/dispatches";

    expect(getWorkerTriggerConfigurationError()).toBe(
      "WORKER_GITHUB_DISPATCH_TOKEN is required for the configured GitHub repository dispatch endpoint."
    );
  });

  it("normalizes empty response bodies to a compact marker", () => {
    expect(summarizeResponseBody("   \n\t  ")).toBe("<empty>");
  });
});
