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

export async function triggerWorker(context: string): Promise<void> {
  const rawUrl = process.env.WORKER_TRIGGER_URL;
  if (!rawUrl) return;

  const secret = process.env.WORKER_TRIGGER_SECRET;
  const endpoint = resolveWorkerTriggerEndpoint(rawUrl);
  const isGitHub = endpoint.includes("api.github.com");

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
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
      return;
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
  } catch (error) {
    console.error(`[worker-trigger:${context}] request error endpoint=${endpoint}`, error);
  }
}

export { resolveWorkerTriggerEndpoint, summarizeResponseBody };
