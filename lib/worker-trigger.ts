function resolveWorkerTriggerEndpoint(url: string): string {
  const trimmed = url.trim();
  if (trimmed.includes("api.github.com")) {
    return trimmed;
  }
  if (trimmed.endsWith("/trigger")) {
    return trimmed;
  }
  return `${trimmed.replace(/\/+$/, "")}/trigger`;
}

function summarizeResponseBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "<empty>";
  return normalized.slice(0, 200);
}

function isGitHubDispatchEndpoint(endpoint: string): boolean {
  return endpoint.includes("api.github.com");
}

function resolveWorkerTriggerToken(isGitHub: boolean): string | undefined {
  if (isGitHub) {
    return process.env.WORKER_GITHUB_DISPATCH_TOKEN ?? process.env.WORKER_TRIGGER_SECRET;
  }
  return process.env.WORKER_TRIGGER_SECRET;
}

export type WorkerTriggerResult =
  | { status: "not_configured"; attempted: false }
  | { status: "missing_token"; attempted: false; envName: string; triggerKind: string }
  | { status: "ok"; attempted: true; endpoint: string }
  | { status: "http_error"; attempted: true; endpoint: string; responseStatus: number }
  | { status: "network_error"; attempted: true; endpoint: string };

export function getWorkerTriggerConfigurationError(): string | null {
  const rawUrl = process.env.WORKER_TRIGGER_URL;
  if (!rawUrl) return null;

  const endpoint = resolveWorkerTriggerEndpoint(rawUrl);
  const isGitHub = isGitHubDispatchEndpoint(endpoint);
  const token = resolveWorkerTriggerToken(isGitHub);

  if (token) return null;

  const envName = isGitHub ? "WORKER_GITHUB_DISPATCH_TOKEN" : "WORKER_TRIGGER_SECRET";
  const triggerKind = isGitHub ? "GitHub repository dispatch endpoint" : "worker trigger endpoint";
  return `${envName} is required for the configured ${triggerKind}.`;
}

export async function triggerWorker(context: string): Promise<WorkerTriggerResult> {
  const rawUrl = process.env.WORKER_TRIGGER_URL;
  if (!rawUrl) return { status: "not_configured", attempted: false };

  const endpoint = resolveWorkerTriggerEndpoint(rawUrl);
  const isGitHub = isGitHubDispatchEndpoint(endpoint);
  const token = resolveWorkerTriggerToken(isGitHub);

  if (!token) {
    const envName = isGitHub ? "WORKER_GITHUB_DISPATCH_TOKEN" : "WORKER_TRIGGER_SECRET";
    const triggerKind = isGitHub
      ? "GitHub repository dispatch endpoint"
      : "worker trigger endpoint";
    console.error(`[worker-trigger:${context}] missing ${envName} for ${triggerKind}`);
    return { status: "missing_token", attempted: false, envName, triggerKind };
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (isGitHub) {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: isGitHub ? JSON.stringify({ event_type: "run-worker" }) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      return { status: "ok", attempted: true, endpoint };
    }

    let bodySnippet = "<unavailable>";
    try {
      bodySnippet = summarizeResponseBody(await response.text());
    } catch {
      bodySnippet = "<unavailable>";
    }

    console.error(
      `[worker-trigger:${context}] failed status=${response.status} endpoint=${endpoint} body=${bodySnippet}`
    );
    return {
      status: "http_error",
      attempted: true,
      endpoint,
      responseStatus: response.status,
    };
  } catch (error) {
    console.error(`[worker-trigger:${context}] request error endpoint=${endpoint}`, error);
    return { status: "network_error", attempted: true, endpoint };
  }
}

export {
  isGitHubDispatchEndpoint,
  resolveWorkerTriggerEndpoint,
  resolveWorkerTriggerToken,
  summarizeResponseBody,
};
