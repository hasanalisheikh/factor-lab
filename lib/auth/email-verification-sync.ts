export const EMAIL_VERIFICATION_SYNC_STORAGE_KEY = "factorlab:auth:email-verification-complete";
export const EMAIL_VERIFICATION_SYNC_CHANNEL = "factorlab:auth:email-verification-complete";

export function broadcastEmailVerificationComplete() {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    completedAt: Date.now(),
  });

  try {
    window.localStorage.setItem(EMAIL_VERIFICATION_SYNC_STORAGE_KEY, payload);
  } catch {
    // localStorage may be unavailable in private contexts; BroadcastChannel still helps.
  }

  if (typeof window.BroadcastChannel === "function") {
    const channel = new window.BroadcastChannel(EMAIL_VERIFICATION_SYNC_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }
}

export function subscribeToEmailVerificationComplete(onComplete: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === EMAIL_VERIFICATION_SYNC_STORAGE_KEY && event.newValue) {
      onComplete();
    }
  };

  window.addEventListener("storage", handleStorage);

  let channel: BroadcastChannel | null = null;
  let handleChannelMessage: (() => void) | null = null;

  if (typeof window.BroadcastChannel === "function") {
    channel = new window.BroadcastChannel(EMAIL_VERIFICATION_SYNC_CHANNEL);
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
