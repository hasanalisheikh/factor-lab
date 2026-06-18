import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { buildVerifyUrl, type VerificationFlow } from "@/lib/auth/verification-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAccountCreationRateLimit } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";

import {
  getActivationVerificationCallbackUrl,
  getRequestOrigin,
  getSignupVerificationCallbackUrl,
} from "./callbacks";
import { ACCOUNT_EXISTS_ERROR, type AuthApiError, type AuthState } from "./state";

export async function transferGuestRuns(guestUserId: string, newUserId: string) {
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

export async function sendVerificationEmail({
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

export async function checkCreateAccountRateLimit(): Promise<AuthState> {
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, error } = await checkAccountCreationRateLimit(ip);

  if (allowed) {
    return null;
  }

  return { error: error ?? "Rate limit exceeded. Try again later." };
}

export function isEmailAlreadyTakenError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("already exists") ||
    normalized.includes("duplicate key")
  );
}

export async function findUserByEmail(
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

export async function upgradeGuestUserInPlace({
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
