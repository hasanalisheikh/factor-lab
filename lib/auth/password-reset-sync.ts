export const PASSWORD_RESET_SYNC_STORAGE_KEY = "factorlab:auth:password-reset-complete";
export const PASSWORD_RESET_SYNC_CHANNEL = "factorlab:auth:password-reset-complete";

function parseCompletionTimestamp(payload: string | null | undefined) {
  if (!payload) {
    return null;
  }

  try {
    const completedAt = Number((JSON.parse(payload) as { completedAt?: unknown }).completedAt);
    return Number.isFinite(completedAt) && completedAt > 0 ? completedAt : null;
  } catch {
    return null;
  }
}

export function broadcastPasswordResetComplete() {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    completedAt: Date.now(),
  });

  try {
    window.localStorage.setItem(PASSWORD_RESET_SYNC_STORAGE_KEY, payload);
  } catch {
    // localStorage may be unavailable in private contexts; BroadcastChannel still helps.
  }

  if (typeof window.BroadcastChannel === "function") {
    const channel = new window.BroadcastChannel(PASSWORD_RESET_SYNC_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }
}

export function subscribeToPasswordResetComplete(onComplete: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const subscribedAt = Date.now();
  let hasNotified = false;

  const maybeNotify = (payload?: string | null) => {
    if (hasNotified) {
      return;
    }

    const completedAt = parseCompletionTimestamp(
      payload ?? window.localStorage.getItem(PASSWORD_RESET_SYNC_STORAGE_KEY)
    );
    if (completedAt == null || completedAt < subscribedAt) {
      return;
    }

    hasNotified = true;
    onComplete();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === PASSWORD_RESET_SYNC_STORAGE_KEY) {
      maybeNotify(event.newValue);
    }
  };
  const handleFocus = () => maybeNotify();
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      maybeNotify();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  let channel: BroadcastChannel | null = null;
  let handleChannelMessage: ((event: MessageEvent) => void) | null = null;

  if (typeof window.BroadcastChannel === "function") {
    channel = new window.BroadcastChannel(PASSWORD_RESET_SYNC_CHANNEL);
    handleChannelMessage = (event) => {
      maybeNotify(typeof event.data === "string" ? event.data : null);
    };
    channel.addEventListener("message", handleChannelMessage);
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (channel && handleChannelMessage) {
      channel.removeEventListener("message", handleChannelMessage);
    }
    channel?.close();
  };
}
