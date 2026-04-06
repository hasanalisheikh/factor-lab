export const PASSWORD_RESET_SYNC_STORAGE_KEY = "factorlab:auth:password-reset-complete";
export const PASSWORD_RESET_SYNC_CHANNEL = "factorlab:auth:password-reset-complete";

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

  const handleStorage = (event: StorageEvent) => {
    if (event.key === PASSWORD_RESET_SYNC_STORAGE_KEY && event.newValue) {
      onComplete();
    }
  };

  window.addEventListener("storage", handleStorage);

  let channel: BroadcastChannel | null = null;
  let handleChannelMessage: (() => void) | null = null;

  if (typeof window.BroadcastChannel === "function") {
    channel = new window.BroadcastChannel(PASSWORD_RESET_SYNC_CHANNEL);
    handleChannelMessage = () => onComplete();
    channel.addEventListener("message", handleChannelMessage);
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    if (channel && handleChannelMessage) {
      channel.removeEventListener("message", handleChannelMessage);
    }
    channel?.close();
  };
}
