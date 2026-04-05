"use server";

import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildResendCooldownMessage,
  isResendRateLimitError,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";
import {
  buildVerifyUrl,
  normalizeVerificationFlow,
  type VerificationFlow,
} from "@/lib/auth/verification-flow";
import { checkAccountCreationRateLimit, checkResendRateLimit } from "@/lib/supabase/rate-limit";

async function transferGuestRuns(guestUserId: string, newUserId: string) {
  const admin = createAdminClient();
  await admin.from("runs").update({ user_id: newUserId }).eq("user_id", guestUserId);
  const notificationsUpdate = await admin
    .from("notifications")
    .update({ user_id: newUserId })
    .eq("user_id", guestUserId);
  if (notificationsUpdate.error && !notificationsUpdate.error.message.includes("does not exist")) {
    console.warn(
      "[auth] transferGuestRuns notifications update:",
      notificationsUpdate.error.message
    );
  }
  await admin.auth.admin.deleteUser(guestUserId);
}

export type AuthState = { error: string } | { unverifiedEmail: string } | null;
export type ResendState =
  | { error: string }
  | { success: true; cooldownSeconds: number }
  | { rateLimited: true; cooldownSeconds: number; message: string }
  | { providerLimited: true; message: string }
  | null;
export type ForgotPasswordState = { success: true } | { error: string } | null;
export type ResetPasswordState = { error: string } | null;

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

const emailPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
});

const ACCOUNT_EXISTS_ERROR =
  "An account with this email already exists. Sign in to that account instead.";

type AuthApiError = { message: string; status?: number; code?: string };

function normalizeOrigin(origin: string) {
  return origin.replace(/\/+$/, "");
}

async function getRequestOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  }

  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) {
    return normalizeOrigin(origin);
  }

  const forwardedHost = headersList.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headersList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return normalizeOrigin(`${forwardedProto ?? "https"}://${forwardedHost}`);
  }

  const host = headersList.get("host")?.split(",")[0]?.trim();
  if (host) {
    const protocol =
      forwardedProto ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return normalizeOrigin(`${protocol}://${host}`);
  }

  return "http://localhost:3000";
}

function getSignupVerificationCallbackUrl(origin: string) {
  return `${origin}/auth/callback?signup_confirm=1`;
}

function getActivationVerificationCallbackUrl(origin: string) {
  return `${origin}/auth/callback?activation=1`;
}

async function sendVerificationEmail({
  email,
  origin,
  flow,
}: {
  email: string;
  origin: string;
  flow: VerificationFlow;
}): Promise<{ error: AuthApiError | null }> {
  const admin = createAdminClient();
  const { error } = await admin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo:
        flow === "upgrade"
          ? getActivationVerificationCallbackUrl(origin)
          : getSignupVerificationCallbackUrl(origin),
    },
  });

  return { error };
}

function buildResendSuccessState(): Extract<ResendState, { success: true; cooldownSeconds: number }> {
  return {
    success: true,
    cooldownSeconds: RESEND_VERIFICATION_COOLDOWN_SECONDS,
  };
}

function buildResendRateLimitedState(
  retryAfterSeconds = RESEND_VERIFICATION_COOLDOWN_SECONDS,
  message = buildResendCooldownMessage(retryAfterSeconds)
): Extract<ResendState, { rateLimited: true; cooldownSeconds: number; message: string }> {
  return {
    rateLimited: true,
    cooldownSeconds: retryAfterSeconds,
    message,
  };
}

function buildResendProviderLimitedState(
  message = "We've sent too many verification emails recently. Please try again later. Check your inbox and spam for the latest email."
): Extract<ResendState, { providerLimited: true; message: string }> {
  return {
    providerLimited: true,
    message,
  };
}

function isProviderEmailSendLimitError(error: AuthApiError | null) {
  return (
    !!error &&
    (error.code === "over_email_send_rate_limit" ||
      error.message.toLowerCase().includes("email rate limit exceeded"))
  );
}

function isAuthRateLimitError(error: AuthApiError | null) {
  return !!error && (error.status === 429 || isResendRateLimitError(error.message));
}

async function checkCreateAccountRateLimit(): Promise<AuthState> {
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, error } = await checkAccountCreationRateLimit(ip);

  if (allowed) {
    return null;
  }

  return { error: error ?? "Rate limit exceeded. Try again later." };
}

function isEmailAlreadyTakenError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("already exists") ||
    normalized.includes("duplicate key")
  );
}

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn("[auth] listUsers email lookup failed:", error.message);
      return null;
    }

    const match = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === normalizedEmail
    );
    if (match) {
      return match;
    }

    const hasMorePages =
      data.nextPage != null ||
      (data.lastPage > 0 && page < data.lastPage) ||
      data.users.length === perPage;

    if (!hasMorePages) {
      return null;
    }

    page += 1;
  }
}

async function upgradeGuestUserInPlace({
  supabase,
  guestUser,
  email,
  password,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  guestUser: User;
  email: string;
  password: string;
}): Promise<AuthState> {
  const admin = createAdminClient();
  const existingUser = await findUserByEmail(admin, email);

  if (existingUser && existingUser.id !== guestUser.id) {
    return { error: ACCOUNT_EXISTS_ERROR };
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(guestUser.id, {
    email,
    password,
    user_metadata: {
      ...(guestUser.user_metadata ?? {}),
      is_guest: false,
    },
    // Confirm the email directly so it is immediately discoverable by signInWithOtp.
    // With email_confirm: false, GoTrue stores the new address as a pending
    // email_change rather than setting email, which makes the subsequent OTP call
    // fail ("user not found"). The OTP itself is what proves email ownership.
    email_confirm: true,
  });

  if (updateError) {
    if (isEmailAlreadyTakenError(updateError.message)) {
      return { error: ACCOUNT_EXISTS_ERROR };
    }

    return { error: updateError.message };
  }

  const origin = await getRequestOrigin();

  // Send the activation magic-link via the admin client.
  // admin.auth carries the service-role key in the apikey header; GoTrue's OTP
  // handler skips per-email and per-IP rate-limit checks for service-role callers.
  // Each new OTP call replaces the previous token, so old activation emails are
  // automatically invalidated.
  const { error: otpError } = await admin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: getActivationVerificationCallbackUrl(origin),
    },
  });
  if (otpError) {
    console.warn("[auth] upgradeGuestUserInPlace: signInWithOtp failed:", otpError.message);
  }

  await supabase.auth.signOut();

  redirect(
    buildVerifyUrl({
      email,
      flow: "upgrade",
      sentAt: otpError ? undefined : Date.now(),
    })
  );
}

export async function upgradeGuestToEmailPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<AuthState> {
  const parsed = emailPasswordSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const rateLimitState = await checkCreateAccountRateLimit();
  if (rateLimitState) {
    return rateLimitState;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Sign in as a guest before upgrading your account." };
  }

  if (user.user_metadata?.is_guest !== true) {
    return { error: "Only guest accounts can be upgraded here." };
  }

  return upgradeGuestUserInPlace({
    supabase,
    guestUser: user,
    email: parsed.data.email,
    password: parsed.data.password,
  });
}

export async function upgradeGuestAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  return upgradeGuestToEmailPassword({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = emailPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Capture any active guest session before it gets replaced
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  const guestUserId = currentUser?.user_metadata?.is_guest === true ? currentUser.id : null;

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const status = (error as { status?: number }).status;
    const message = error.message.toLowerCase();
    if (status === 429 || message.includes("rate limit") || message.includes("too many")) {
      return { error: "Too many sign-in attempts. Please wait a bit and try again." };
    }
    if (message.includes("email not confirmed")) {
      return { unverifiedEmail: parsed.data.email };
    }
    return { error: "Invalid email or password." };
  }

  // Transfer any guest runs to the newly signed-in account
  if (guestUserId && signInData.user && signInData.user.id !== guestUserId) {
    await transferGuestRuns(guestUserId, signInData.user.id);
  }

  redirect("/dashboard");
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = emailPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const rateLimitState = await checkCreateAccountRateLimit();
  if (rateLimitState) {
    return rateLimitState;
  }

  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (currentUser?.user_metadata?.is_guest === true) {
    return upgradeGuestUserInPlace({
      supabase,
      guestUser: currentUser,
      email: parsed.data.email,
      password: parsed.data.password,
    });
  }

  // Build the callback URL for email verification.
  // NEXT_PUBLIC_SITE_URL should be set to https://factor-lab.vercel.app in production.
  // Falls back to the request origin (works for local dev automatically).
  const origin = await getRequestOrigin();
  const emailRedirectTo = getSignupVerificationCallbackUrl(origin);

  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo },
  });

  if (error) {
    if (isEmailAlreadyTakenError(error.message)) {
      return { error: ACCOUNT_EXISTS_ERROR };
    }
    return { error: error.message };
  }

  // When email confirmation is enabled, Supabase silently re-sends the confirmation
  // email for duplicate addresses instead of returning an error. An empty identities
  // array is the reliable signal that the email is already taken.
  if (signUpData.user && (signUpData.user.identities?.length ?? 0) === 0) {
    return { error: ACCOUNT_EXISTS_ERROR };
  }

  if (!signUpData.session) {
    // Email confirmation required — session will be established when they click the link
    const verifyUrl = buildVerifyUrl({
      email: parsed.data.email,
      flow: "signup",
      sentAt: Date.now(),
    });
    redirect(verifyUrl);
  }

  redirect("/dashboard");
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !z.string().email().safeParse(email).success) {
    return { error: "Please enter a valid email address." };
  }

  const origin = await getRequestOrigin();

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Always return success — don't reveal whether the email exists
  return { success: true };
}

// ─── Reset Password ───────────────────────────────────────────────────────────

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

  redirect("/dashboard");
}

// ─── Resend Verification Email ────────────────────────────────────────────────

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
        buildResendCooldownMessage(
          retryAfterSeconds ?? RESEND_VERIFICATION_COOLDOWN_SECONDS
        )
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
