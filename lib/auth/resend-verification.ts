export const RESEND_VERIFICATION_COOLDOWN_SECONDS = 60;

export function buildResendCooldownMessage(seconds: number, emailLabel = "verification email") {
  return `Please wait ${seconds} seconds before requesting another ${emailLabel}.`;
}

export function getRemainingResendCooldownSeconds(sentAt: number, now = Date.now()) {
  const elapsedSeconds = Math.floor((now - sentAt) / 1000);
  return Math.max(0, RESEND_VERIFICATION_COOLDOWN_SECONDS - elapsedSeconds);
}

export function isResendRateLimitError(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();

  return (
    normalized.includes("rate limit") ||
    normalized.includes("too many") ||
    normalized.includes("security purposes") ||
    normalized.includes("over_email_send_rate_limit") ||
    normalized.includes("email_sent_rate_limit")
  );
}
