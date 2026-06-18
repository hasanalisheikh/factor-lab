"use server";

import { redirect } from "next/navigation";

import { buildVerifyUrl } from "@/lib/auth/verification-flow";
import { createClient } from "@/lib/supabase/server";

import { getRequestOrigin, getSignupVerificationCallbackUrl } from "./callbacks";
import { emailPasswordSchema } from "./schemas";
import {
  checkCreateAccountRateLimit,
  isEmailAlreadyTakenError,
  transferGuestRuns,
  upgradeGuestUserInPlace,
} from "./helpers";
import { ACCOUNT_EXISTS_ERROR, type AuthState } from "./state";

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

  if (signUpData.user && (signUpData.user.identities?.length ?? 0) === 0) {
    return { error: ACCOUNT_EXISTS_ERROR };
  }

  if (!signUpData.session) {
    const verifyUrl = buildVerifyUrl({
      email: parsed.data.email,
      flow: "signup",
      sentAt: Date.now(),
    });
    redirect(verifyUrl);
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
