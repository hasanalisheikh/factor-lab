import {
  buildResendCooldownMessage,
  isResendRateLimitError,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";

export type AuthState = { error: string } | { unverifiedEmail: string } | null;
export type ResendState =
  | { error: string }
  | { success: true; cooldownSeconds: number }
  | { rateLimited: true; cooldownSeconds: number; message: string }
  | { providerLimited: true; message: string }
  | null;
export type ForgotPasswordState =
  | { error: string }
  | { success: true; cooldownSeconds: number; sentAt: number }
  | { rateLimited: true; cooldownSeconds: number; message: string }
  | { providerLimited: true; message: string }
  | null;
export type ResetPasswordState = { success: true } | { error: string } | null;

export const ACCOUNT_EXISTS_ERROR =
  "An account with this email already exists. Sign in to that account instead.";
export const PASSWORD_RESET_EMAIL_LABEL = "password reset email";
export const PASSWORD_RESET_RESEND_PREFIX = "factorlab:resend-reset";

export type AuthApiError = { message: string; status?: number; code?: string };

export function buildResendSuccessState(): Extract<
  ResendState,
  { success: true; cooldownSeconds: number }
> {
  return {
    success: true,
    cooldownSeconds: RESEND_VERIFICATION_COOLDOWN_SECONDS,
  };
}

export function buildResendRateLimitedState(
  retryAfterSeconds = RESEND_VERIFICATION_COOLDOWN_SECONDS,
  message = buildResendCooldownMessage(retryAfterSeconds)
): Extract<ResendState, { rateLimited: true; cooldownSeconds: number; message: string }> {
  return {
    rateLimited: true,
    cooldownSeconds: retryAfterSeconds,
    message,
  };
}

export function buildResendProviderLimitedState(
  message = "We've sent too many verification emails recently. Please try again later. Check your inbox and spam for the latest email."
): Extract<ResendState, { providerLimited: true; message: string }> {
  return {
    providerLimited: true,
    message,
  };
}

export function buildForgotPasswordSuccessState(
  sentAt: number
): Extract<ForgotPasswordState, { success: true; cooldownSeconds: number; sentAt: number }> {
  return {
    success: true,
    cooldownSeconds: RESEND_VERIFICATION_COOLDOWN_SECONDS,
    sentAt,
  };
}

export function buildForgotPasswordRateLimitedState(
  retryAfterSeconds = RESEND_VERIFICATION_COOLDOWN_SECONDS,
  message = buildResendCooldownMessage(retryAfterSeconds, PASSWORD_RESET_EMAIL_LABEL)
): Extract<ForgotPasswordState, { rateLimited: true; cooldownSeconds: number; message: string }> {
  return {
    rateLimited: true,
    cooldownSeconds: retryAfterSeconds,
    message,
  };
}

export function buildForgotPasswordProviderLimitedState(
  message = "We've sent too many password reset emails recently. Please try again later. Check your inbox and spam for the latest email."
): Extract<ForgotPasswordState, { providerLimited: true; message: string }> {
  return {
    providerLimited: true,
    message,
  };
}

export function isProviderEmailSendLimitError(error: AuthApiError | null) {
  return (
    !!error &&
    (error.code === "over_email_send_rate_limit" ||
      error.message.toLowerCase().includes("email rate limit exceeded"))
  );
}

export function isAuthRateLimitError(error: AuthApiError | null) {
  return !!error && (error.status === 429 || isResendRateLimitError(error.message));
}
