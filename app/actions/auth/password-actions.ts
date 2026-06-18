"use server";

import { z } from "zod";

import {
  buildResendCooldownMessage,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";
import { normalizeVerificationFlow } from "@/lib/auth/verification-flow";
import { checkResendRateLimit } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";

import { getRequestOrigin, getResetPasswordCallbackUrl } from "./callbacks";
import { sendVerificationEmail } from "./helpers";
import { passwordSchema } from "./schemas";
import {
  buildForgotPasswordProviderLimitedState,
  buildForgotPasswordRateLimitedState,
  buildForgotPasswordSuccessState,
  buildResendProviderLimitedState,
  buildResendRateLimitedState,
  buildResendSuccessState,
  isAuthRateLimitError,
  isProviderEmailSendLimitError,
  PASSWORD_RESET_EMAIL_LABEL,
  PASSWORD_RESET_RESEND_PREFIX,
  type ForgotPasswordState,
  type ResendState,
  type ResetPasswordState,
} from "./state";

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !z.string().email().safeParse(email).success) {
    return { error: "Please enter a valid email address." };
  }

  const origin = await getRequestOrigin();
  const {
    allowed,
    error: rateLimitError,
    retryAfterSeconds,
  } = await checkResendRateLimit(email, {
    prefix: PASSWORD_RESET_RESEND_PREFIX,
    emailLabel: PASSWORD_RESET_EMAIL_LABEL,
  });
  if (!allowed) {
    return buildForgotPasswordRateLimitedState(
      retryAfterSeconds,
      rateLimitError ??
        buildResendCooldownMessage(retryAfterSeconds ?? 60, PASSWORD_RESET_EMAIL_LABEL)
    );
  }

  const supabase = await createClient();
  const sentAt = Date.now();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getResetPasswordCallbackUrl(origin, {
      email,
      sentAt,
    }),
  });
  if (error) {
    if (isProviderEmailSendLimitError(error)) {
      return buildForgotPasswordProviderLimitedState();
    }

    if (isAuthRateLimitError(error)) {
      return buildForgotPasswordRateLimitedState();
    }

    console.warn("[auth] forgotPasswordAction: resetPasswordForEmail failed:", error.message);
    return {
      error: "We couldn't send a password reset email right now. Please try again in a moment.",
    };
  }

  // Always return success — don't reveal whether the email exists
  return buildForgotPasswordSuccessState(sentAt);
}

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function resendVerificationAction(
  _prev: ResendState,
  formData: FormData
): Promise<ResendState> {
  const email = String(formData.get("email") ?? "").trim();
  const flow = normalizeVerificationFlow(String(formData.get("flow") ?? ""));
  if (!email) {
    return { error: "Email address is required." };
  }

  const { allowed, error: rateLimitError, retryAfterSeconds } = await checkResendRateLimit(email);
  if (!allowed) {
    return buildResendRateLimitedState(
      retryAfterSeconds,
      rateLimitError ??
        buildResendCooldownMessage(retryAfterSeconds ?? RESEND_VERIFICATION_COOLDOWN_SECONDS)
    );
  }

  const origin = await getRequestOrigin();

  if (flow) {
    const { error } = await sendVerificationEmail({
      email,
      origin,
      flow,
    });
    if (error) {
      if (isProviderEmailSendLimitError(error)) {
        return buildResendProviderLimitedState();
      }
      if (isAuthRateLimitError(error)) {
        return buildResendRateLimitedState();
      }
      return { error: error.message };
    }

    return buildResendSuccessState();
  }

  const { error: signupError } = await sendVerificationEmail({
    email,
    origin,
    flow: "signup",
  });
  if (!signupError) {
    return buildResendSuccessState();
  }

  if (isProviderEmailSendLimitError(signupError)) {
    return buildResendProviderLimitedState();
  }

  if (isAuthRateLimitError(signupError)) {
    return buildResendRateLimitedState();
  }

  const { error: upgradeError } = await sendVerificationEmail({
    email,
    origin,
    flow: "upgrade",
  });
  if (upgradeError) {
    if (isProviderEmailSendLimitError(upgradeError)) {
      return buildResendProviderLimitedState();
    }
    if (isAuthRateLimitError(upgradeError)) {
      return buildResendRateLimitedState();
    }
    return { error: signupError.message };
  }

  return buildResendSuccessState();
}
