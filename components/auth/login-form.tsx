"use client";

import { startTransition, useActionState, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  forgotPasswordAction,
  resendVerificationAction,
  signInAction,
  signUpAction,
  upgradeGuestAction,
} from "@/app/actions/auth";
import { normalizeVerificationFlow } from "@/lib/auth/verification-flow";

import { LoginFormShell } from "./login-form/login-form-shell";
import { normalizeAuthTab, parseSentAt } from "./login-form/types";
import {
  useAuthCooldowns,
  useAuthResultUrlSync,
  useAuthSearchParamSync,
  usePasswordResetCompleteSync,
  useValidateGuestSession,
  useVerifyTabSessionSync,
} from "./login-form/use-auth-session-effects";

import type { AuthState, ForgotPasswordState, ResendState } from "@/app/actions/auth";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { LoginFormProps } from "./login-form/types";

export function LoginForm({
  authError,
  initialTab,
  initialEmail,
  initialFlow,
  initialSentAt,
  verifyError,
  forgotError,
  sessionUser,
}: LoginFormProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signInState, signInAction_, isSignInPending] = useActionState<AuthState, FormData>(
    signInAction,
    null
  );
  const [signUpState, signUpAction_, isSignUpPending] = useActionState<AuthState, FormData>(
    signUpAction,
    null
  );
  const [upgradeState, upgradeAction_, isUpgradePending] = useActionState<AuthState, FormData>(
    upgradeGuestAction,
    null
  );
  const [resendState, resendAction_, isResendPending] = useActionState<ResendState, FormData>(
    resendVerificationAction,
    null
  );
  const [forgotState, forgotAction_, isForgotPending] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordAction, null);

  const [passwordResetComplete, setPasswordResetComplete] = useState(false);
  const [isGuestPending, setIsGuestPending] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const searchTab = normalizeAuthTab(searchParams.get("tab"));
  const searchEmail = searchParams.get("email") ?? undefined;
  const hasSearchFlow = searchParams.has("flow");
  const searchFlow = normalizeVerificationFlow(searchParams.get("flow"));
  const searchSentAt = parseSentAt(searchParams.get("sent_at"));
  const [activeTab, setActiveTab] = useState(searchTab ?? initialTab ?? "signin");

  const [resolvedIsGuest, setResolvedIsGuest] = useState<boolean>(sessionUser?.isGuest === true);
  useValidateGuestSession({ sessionUser, setActiveTab, setResolvedIsGuest });

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMismatchError, setPasswordMismatchError] = useState<string | null>(null);
  const initialForgotEmail = initialTab === "forgot" ? initialEmail : undefined;
  const initialForgotSentAt = initialTab === "forgot" ? initialSentAt : undefined;
  const [forgotEmail, setForgotEmail] = useState(
    searchTab === "forgot" ? (searchEmail ?? initialForgotEmail ?? "") : (initialForgotEmail ?? "")
  );
  const lockedVerifyEmail = searchEmail ?? initialEmail;
  const [verifyEmail, setVerifyEmail] = useState(lockedVerifyEmail ?? "");
  const [verifyFlow, setVerifyFlow] = useState<VerificationFlow | undefined>(
    searchFlow ?? initialFlow
  );
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendBannerMode, setResendBannerMode] = useState<"sent" | "cooldown" | null>(null);
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [forgotBannerMode, setForgotBannerMode] = useState<"sent" | "cooldown" | null>(null);
  const verifySentAt = searchSentAt ?? initialSentAt;
  const forgotSentAt = searchTab === "forgot" ? searchSentAt : initialForgotSentAt;

  useAuthCooldowns({
    activeTab,
    forgotCooldown,
    forgotError,
    forgotSentAt,
    forgotState,
    resendCooldown,
    resendState,
    setForgotBannerMode,
    setForgotCooldown,
    setResendBannerMode,
    setResendCooldown,
    verifyError,
    verifySentAt,
  });

  useAuthSearchParamSync({
    hasSearchFlow,
    initialFlow,
    initialForgotEmail,
    searchEmail,
    searchFlow,
    searchTab,
    setActiveTab,
    setForgotEmail,
    setVerifyEmail,
    setVerifyFlow,
  });
  useVerifyTabSessionSync({ activeTab, router });

  useAuthResultUrlSync({
    activeTab,
    forgotEmail,
    forgotSentAt,
    forgotState,
    pathname,
    resendState,
    router,
    searchEmail,
    searchFlow,
    searchParams,
    searchSentAt,
    searchTab,
    verifyEmail,
    verifyFlow,
  });

  usePasswordResetCompleteSync({
    activeTab,
    forgotEmail,
    pathname,
    router,
    searchParams,
    setActiveTab,
    setGuestError,
    setPasswordMismatchError,
    setPasswordResetComplete,
    setSignInEmail,
    setSignInPassword,
    setVerifyFlow,
    signInEmail,
  });

  function replaceAuthUrl(nextParams: URLSearchParams) {
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const isGuestSession = resolvedIsGuest;
  const createAccountAction = isGuestSession ? upgradeAction_ : signUpAction_;
  const createAccountState = isGuestSession ? upgradeState : signUpState;
  const isCreateAccountPending = isGuestSession ? isUpgradePending : isSignUpPending;
  const isAnyPending = isSignInPending || isSignUpPending || isUpgradePending || isGuestPending;

  const isExistingAccountError = (error: string) => {
    const message = error.toLowerCase();
    return (
      message.includes("already exists") ||
      message.includes("already registered") ||
      message.includes("sign in to that account instead")
    );
  };

  const formatFriendlyError = (error: string) => {
    const message = error.toLowerCase();
    if (message.includes("rate limit") || message.includes("too many") || message.includes("429")) {
      return "Too many attempts right now. Please wait a bit and try again.";
    }
    return error;
  };

  function getCreateAccountErrorMessage(error: string) {
    if (!isExistingAccountError(error)) {
      return formatFriendlyError(error);
    }

    if (isGuestSession) {
      return "An account with this email already exists. Sign in to that account instead. Your guest runs and settings are still safe in this guest session.";
    }

    return "An account with this email already exists. Sign in to that account instead.";
  }

  function switchToSignInTab() {
    setSignInEmail(signUpEmail.trim());
    setSignInPassword("");
    switchTab("signin");
  }

  async function handleGuest() {
    if (isAnyPending) return;
    setIsGuestPending(true);
    setGuestError(null);
    setPasswordMismatchError(null);
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const rawError =
          (data as { error?: string }).error ?? "Failed to create guest account. Try again.";
        setGuestError(formatFriendlyError(rawError));
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setGuestError("Network error. Please check your connection and try again.");
    } finally {
      setIsGuestPending(false);
    }
  }

  function switchTab(tab: "signin" | "signup") {
    setActiveTab(tab);
    setGuestError(null);
    setPasswordMismatchError(null);
    setPasswordResetComplete(false);
    setVerifyFlow(undefined);
    setForgotCooldown(0);
    setForgotBannerMode(null);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("tab");
    nextParams.delete("email");
    nextParams.delete("flow");
    nextParams.delete("sent_at");
    replaceAuthUrl(nextParams);
  }

  function goToVerify(email: string, flow: VerificationFlow = "signup") {
    setVerifyEmail(email);
    setVerifyFlow(flow);
    setActiveTab("verify");
    setGuestError(null);
    setPasswordMismatchError(null);
    setPasswordResetComplete(false);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "verify");
    nextParams.set("email", email);
    nextParams.set("flow", flow);
    nextParams.delete("sent_at");
    replaceAuthUrl(nextParams);
    const formData = new FormData();
    formData.set("email", email);
    formData.set("flow", flow);
    startTransition(() => {
      resendAction_(formData);
    });
  }

  function goToForgotPassword() {
    setForgotEmail(signInEmail);
    setPasswordResetComplete(false);
    setActiveTab("forgot");
    setVerifyFlow(undefined);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "forgot");
    nextParams.delete("email");
    nextParams.delete("flow");
    replaceAuthUrl(nextParams);
  }

  const unverifiedEmail =
    signInState && "unverifiedEmail" in signInState ? signInState.unverifiedEmail : null;
  const signInError =
    signInState && "error" in signInState ? formatFriendlyError(signInState.error) : null;
  const createAccountRawError =
    createAccountState && "error" in createAccountState ? createAccountState.error : null;
  const showSignInInsteadButton =
    createAccountRawError != null && isExistingAccountError(createAccountRawError);
  const signUpError =
    createAccountRawError != null ? getCreateAccountErrorMessage(createAccountRawError) : null;
  const forgotInlineError = forgotState && "error" in forgotState ? forgotState.error : null;
  const forgotProviderLimitedMessage =
    forgotState && "providerLimited" in forgotState ? forgotState.message : null;
  const resendError = resendState && "error" in resendState ? resendState.error : null;
  const resendProviderLimitedMessage =
    resendState && "providerLimited" in resendState ? resendState.message : null;
  const forgotEmailValue = forgotEmail.trim();
  const shouldShowForgotSuccessState =
    activeTab === "forgot" &&
    forgotEmailValue.length > 0 &&
    forgotError == null &&
    forgotInlineError == null &&
    (forgotSentAt !== undefined ||
      Boolean(forgotState && "success" in forgotState) ||
      Boolean(forgotState && "rateLimited" in forgotState));

  const inputClassName =
    "h-9 border-white/10 bg-white/5 text-white/90 placeholder:text-white/45 focus-visible:border-primary/70 focus-visible:ring-primary/40";
  const primaryButtonClassName =
    "h-9 w-full bg-primary text-primary-foreground shadow-[0_14px_28px_-14px_rgba(40,199,130,0.7)] hover:bg-primary/90";

  return (
    <LoginFormShell
      activeTab={activeTab}
      authError={authError}
      isGuestSession={isGuestSession}
      authTabs={{
        activeTab,
        confirmPassword,
        createAccountAction,
        goToVerify,
        inputClassName,
        isAnyPending,
        isCreateAccountPending,
        isGuestSession,
        isSignInPending,
        onCreateAccount: () => switchTab("signup"),
        onForgotPassword: goToForgotPassword,
        passwordMismatchError,
        passwordResetComplete,
        primaryButtonClassName,
        setConfirmPassword,
        setGuestError,
        setPasswordMismatchError,
        setSignInEmail,
        setSignInPassword,
        setSignUpEmail,
        setSignUpPassword,
        showSignInInsteadButton,
        signInAction: signInAction_,
        signInEmail,
        signInError,
        signInPassword,
        signUpEmail,
        signUpError,
        signUpPassword,
        switchTab,
        switchToSignInTab,
        unverifiedEmail,
      }}
      forgotView={{
        forgotAction: forgotAction_,
        forgotBannerMode,
        forgotCooldown,
        forgotEmail,
        forgotEmailValue,
        forgotError,
        forgotInlineError,
        forgotProviderLimitedMessage,
        inputClassName,
        isForgotPending,
        primaryButtonClassName,
        setForgotEmail,
        shouldShowForgotSuccessState,
        switchTab,
      }}
      guest={{
        guestError,
        handleGuest,
        isAnyPending,
        isGuestPending,
      }}
      verifyView={{
        formatFriendlyError,
        inputClassName,
        isResendPending,
        lockedVerifyEmail,
        primaryButtonClassName,
        resendAction: resendAction_,
        resendBannerMode,
        resendCooldown,
        resendError,
        resendProviderLimitedMessage,
        setVerifyEmail,
        switchTab,
        verifyEmail,
        verifyError,
        verifyFlow,
      }}
    />
  );
}
