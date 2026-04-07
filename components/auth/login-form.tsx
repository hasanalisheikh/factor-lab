"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import {
  signInAction,
  signUpAction,
  upgradeGuestAction,
  resendVerificationAction,
  forgotPasswordAction,
  type AuthState,
  type ResendState,
  type ForgotPasswordState,
} from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { subscribeToEmailVerificationComplete } from "@/lib/auth/email-verification-sync";
import { subscribeToPasswordResetComplete } from "@/lib/auth/password-reset-sync";
import {
  getRemainingResendCooldownSeconds,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";
import { normalizeVerificationFlow, type VerificationFlow } from "@/lib/auth/verification-flow";
import { createClient } from "@/lib/supabase/client";

type AuthTab = "signin" | "signup" | "verify" | "forgot";

function normalizeAuthTab(tab: string | null | undefined): AuthTab | undefined {
  switch (tab) {
    case "signin":
    case "signup":
    case "verify":
    case "forgot":
      return tab;
    default:
      return undefined;
  }
}

function parseSentAt(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const sentAt = Number(value);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : undefined;
}

function getSentAtForCooldown(cooldownSeconds: number) {
  return Date.now() - Math.max(0, RESEND_VERIFICATION_COOLDOWN_SECONDS - cooldownSeconds) * 1000;
}

export function LoginForm({
  authError,
  initialTab,
  initialEmail,
  initialFlow,
  initialSentAt,
  verifyError,
  forgotError,
  sessionUser,
}: {
  authError?: string;
  initialTab?: AuthTab;
  initialEmail?: string;
  initialFlow?: VerificationFlow;
  initialSentAt?: number;
  verifyError?: string;
  forgotError?: string;
  sessionUser?: {
    email: string | null;
    isGuest: boolean;
  } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasHandledCrossTabSignIn = useRef(false);
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
  const [activeTab, setActiveTab] = useState<AuthTab>(searchTab ?? initialTab ?? "signin");

  // Optimistic from server prop, validated client-side on mount.
  // Guards against stale Next.js router-cache hits (server prop may be up to
  // ~30 s old) and long page-dwell after session expiry.
  const [resolvedIsGuest, setResolvedIsGuest] = useState<boolean>(sessionUser?.isGuest === true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (cancelled) return;
        const isValidGuest = !error && data.user?.user_metadata?.is_guest === true;
        if (!isValidGuest) {
          setResolvedIsGuest(false);
          // If we were placed into upgrade mode by stale server props, reset to
          // the normal Sign In tab so the user isn't trapped.
          setActiveTab((prev) => (prev === "signup" ? "signin" : prev));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedIsGuest(false);
          setActiveTab((prev) => (prev === "signup" ? "signin" : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    if (searchTab) {
      setActiveTab(searchTab);
    }
  }, [searchTab]);

  useEffect(() => {
    if (searchEmail !== undefined) {
      setVerifyEmail(searchEmail);
    }
  }, [searchEmail]);

  useEffect(() => {
    if (searchTab === "forgot") {
      setForgotEmail(searchEmail ?? initialForgotEmail ?? "");
    }
  }, [initialForgotEmail, searchEmail, searchTab]);

  useEffect(() => {
    if (hasSearchFlow) {
      setVerifyFlow(searchFlow);
      return;
    }

    if (searchTab === "verify" && initialFlow === undefined) {
      setVerifyFlow(undefined);
    }
  }, [hasSearchFlow, initialFlow, searchFlow, searchTab]);

  // When on the verify tab, listen for a sign-in from the activation link opened
  // in another tab. Supabase writes the session to localStorage and fires
  // onAuthStateChange in all tabs sharing the same origin.
  useEffect(() => {
    if (activeTab !== "verify") return;

    const completeCrossTabSignIn = () => {
      if (hasHandledCrossTabSignIn.current) return;
      hasHandledCrossTabSignIn.current = true;
      router.refresh();
      router.replace("/dashboard");
    };

    const supabase = createClient();
    const checkForExistingSession = async () => {
      if (hasHandledCrossTabSignIn.current) {
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session) {
        completeCrossTabSignIn();
      }
    };
    const handleWindowFocus = () => {
      void checkForExistingSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForExistingSession();
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        completeCrossTabSignIn();
      }
    });
    void checkForExistingSession();

    // Keep polling while the user is waiting on the verify tab. A short
    // timeout can miss real-world email round-trips, and some browsers delay
    // cross-tab storage events while the original tab is in the background.
    const sessionPollId = window.setInterval(() => {
      if (hasHandledCrossTabSignIn.current) {
        window.clearInterval(sessionPollId);
        return;
      }
      void checkForExistingSession();
    }, 1000);
    const unsubscribeCrossTabVerification = subscribeToEmailVerificationComplete(() => {
      void checkForExistingSession();
    });
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(sessionPollId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
      unsubscribeCrossTabVerification();
      hasHandledCrossTabSignIn.current = false;
    };
  }, [activeTab, router]);

  useEffect(() => {
    if (activeTab !== "verify" || verifyError || verifySentAt === undefined) {
      return;
    }

    const remaining = getRemainingResendCooldownSeconds(verifySentAt);
    if (remaining <= 0) {
      return;
    }

    setResendCooldown((current) => Math.max(current, remaining));
    setResendBannerMode((current) => current ?? "cooldown");
  }, [activeTab, verifyError, verifySentAt]);

  useEffect(() => {
    if (activeTab !== "forgot" || forgotError || forgotSentAt === undefined) {
      return;
    }

    const remaining = getRemainingResendCooldownSeconds(forgotSentAt);
    if (remaining <= 0) {
      return;
    }

    setForgotCooldown((current) => Math.max(current, remaining));
    setForgotBannerMode((current) => current ?? "cooldown");
  }, [activeTab, forgotError, forgotSentAt]);

  useEffect(() => {
    if (!resendState) {
      return;
    }

    if ("success" in resendState) {
      setResendCooldown(resendState.cooldownSeconds);
      setResendBannerMode("sent");
      return;
    }

    if ("rateLimited" in resendState) {
      setResendCooldown(resendState.cooldownSeconds);
      setResendBannerMode("cooldown");
    }
  }, [resendState]);

  useEffect(() => {
    if (!forgotState) {
      return;
    }

    if ("success" in forgotState) {
      setForgotCooldown(forgotState.cooldownSeconds);
      setForgotBannerMode("sent");
      return;
    }

    if ("rateLimited" in forgotState) {
      setForgotCooldown(forgotState.cooldownSeconds);
      setForgotBannerMode("cooldown");
    }
  }, [forgotState]);

  useEffect(() => {
    if (activeTab !== "verify" || !verifyEmail || !resendState) {
      return;
    }

    if (!("success" in resendState) && !("rateLimited" in resendState)) {
      return;
    }

    const currentCooldown =
      searchSentAt === undefined ? undefined : getRemainingResendCooldownSeconds(searchSentAt);
    const searchFlowMatches = (searchFlow ?? undefined) === verifyFlow;
    const searchAlreadyMatchesVerifyState =
      searchTab === "verify" &&
      searchEmail === verifyEmail &&
      searchFlowMatches &&
      currentCooldown !== undefined &&
      currentCooldown >= resendState.cooldownSeconds - 1;

    if (searchAlreadyMatchesVerifyState) {
      return;
    }

    const sentAt =
      "success" in resendState ? Date.now() : getSentAtForCooldown(resendState.cooldownSeconds);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "verify");
    nextParams.set("email", verifyEmail);
    if (verifyFlow) {
      nextParams.set("flow", verifyFlow);
    } else {
      nextParams.delete("flow");
    }
    nextParams.set("sent_at", String(sentAt));
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [
    activeTab,
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
  ]);

  useEffect(() => {
    const trimmedForgotEmail = forgotEmail.trim();
    if (activeTab !== "forgot" || !trimmedForgotEmail || !forgotState) {
      return;
    }

    if (!("success" in forgotState) && !("rateLimited" in forgotState)) {
      return;
    }

    const currentCooldown =
      forgotSentAt === undefined ? undefined : getRemainingResendCooldownSeconds(forgotSentAt);
    const searchAlreadyMatchesForgotState =
      searchTab === "forgot" &&
      searchEmail === trimmedForgotEmail &&
      currentCooldown !== undefined &&
      currentCooldown >= forgotState.cooldownSeconds - 1;

    if (searchAlreadyMatchesForgotState) {
      return;
    }

    const sentAt =
      "success" in forgotState
        ? forgotState.sentAt
        : getSentAtForCooldown(forgotState.cooldownSeconds);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "forgot");
    nextParams.set("email", trimmedForgotEmail);
    nextParams.delete("flow");
    nextParams.delete("error");
    nextParams.set("sent_at", String(sentAt));
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [
    activeTab,
    forgotEmail,
    forgotSentAt,
    forgotState,
    pathname,
    router,
    searchEmail,
    searchParams,
    searchTab,
  ]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const id = setInterval(() => setForgotCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [forgotCooldown]);

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

  useEffect(() => {
    if (activeTab !== "signin" && activeTab !== "forgot") {
      return;
    }

    return subscribeToPasswordResetComplete(() => {
      const nextEmail = forgotEmail.trim() || signInEmail.trim();

      setActiveTab("signin");
      setGuestError(null);
      setPasswordMismatchError(null);
      setPasswordResetComplete(true);
      setVerifyFlow(undefined);
      setSignInPassword("");
      if (nextEmail) {
        setSignInEmail(nextEmail);
      }

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("tab");
      nextParams.delete("email");
      nextParams.delete("flow");
      nextParams.delete("sent_at");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }, [activeTab, forgotEmail, pathname, router, searchParams, signInEmail]);

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
    <div className="flex h-full flex-col">
      <div className="absolute top-5 left-5 z-10 flex items-center gap-2">
        <Logo size={26} wordmarkClassName="text-[24px]" />
      </div>

      <div className="space-y-2.5 pt-14">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight text-white/90">
            {activeTab === "signin"
              ? "Sign in"
              : activeTab === "signup"
                ? isGuestSession
                  ? "Create account and keep my runs"
                  : "Create account"
                : activeTab === "forgot"
                  ? "Reset password"
                  : "Verify your email"}
          </h1>
          <p className="text-sm text-white/60">
            {activeTab === "signup" && isGuestSession
              ? "Upgrade this guest session in place. Your runs and settings stay attached to the same account."
              : "Quant research dashboard for backtests and reports."}
          </p>
        </div>

        {authError && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
            <AlertCircle className="size-4" />
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        )}

        {activeTab === "forgot" ? (
          <div className="space-y-3">
            {shouldShowForgotSuccessState ? (
              <>
                <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-5 text-center">
                  <Mail className="text-primary/80 size-8" />
                  <p className="text-sm text-white/70">
                    If an account exists for{" "}
                    <span className="font-medium text-white/90">{forgotEmailValue}</span>,
                    you&apos;ll receive a password reset email shortly.
                  </p>
                </div>

                {forgotCooldown > 0 && forgotBannerMode && (
                  <Alert
                    className={
                      forgotBannerMode === "sent"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-amber-500/40 bg-amber-500/10"
                    }
                  >
                    {forgotBannerMode === "sent" ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <Mail className="size-4 text-amber-300" />
                    )}
                    <AlertDescription
                      className={forgotBannerMode === "sent" ? "text-primary/90" : "text-amber-200"}
                    >
                      {forgotBannerMode === "sent"
                        ? `Password reset email sent. You can resend again in ${forgotCooldown}s.`
                        : `A password reset email was sent recently. You can resend again in ${forgotCooldown}s.`}
                    </AlertDescription>
                  </Alert>
                )}

                {forgotProviderLimitedMessage && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <Mail className="size-4 text-amber-300" />
                    <AlertDescription className="text-amber-200">
                      {forgotProviderLimitedMessage}
                    </AlertDescription>
                  </Alert>
                )}

                <form action={forgotAction_}>
                  <input type="hidden" name="email" value={forgotEmailValue} />
                  <Button
                    type="submit"
                    disabled={isForgotPending || forgotCooldown > 0}
                    aria-disabled={isForgotPending || forgotCooldown > 0}
                    className={primaryButtonClassName}
                  >
                    {isForgotPending ? (
                      <>
                        <Spinner className="size-4" />
                        Sending...
                      </>
                    ) : forgotCooldown > 0 ? (
                      `Resend again in ${forgotCooldown}s`
                    ) : (
                      "Resend reset email"
                    )}
                  </Button>
                </form>

                <Button
                  variant="ghost"
                  onClick={() => switchTab("signin")}
                  className="h-9 w-full border-white/15 text-white/60 hover:bg-white/5 hover:text-white/80"
                >
                  ← Back to Sign in
                </Button>
              </>
            ) : (
              <>
                {(forgotError || forgotInlineError) && (
                  <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{forgotError ?? forgotInlineError}</AlertDescription>
                  </Alert>
                )}
                {forgotProviderLimitedMessage && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <Mail className="size-4 text-amber-300" />
                    <AlertDescription className="text-amber-200">
                      {forgotProviderLimitedMessage}
                    </AlertDescription>
                  </Alert>
                )}
                <form action={forgotAction_} className="space-y-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email" className="text-xs font-medium text-white/60">
                      Email
                    </Label>
                    <Input
                      id="forgot-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      disabled={isForgotPending}
                      className={inputClassName}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isForgotPending}
                    aria-disabled={isForgotPending}
                    className={primaryButtonClassName}
                  >
                    {isForgotPending ? (
                      <>
                        <Spinner className="size-4" />
                        Sending...
                      </>
                    ) : (
                      "Send reset email"
                    )}
                  </Button>
                </form>
                <Button
                  variant="ghost"
                  onClick={() => switchTab("signin")}
                  className="h-9 w-full border-white/15 text-white/60 hover:bg-white/5 hover:text-white/80"
                >
                  ← Back to Sign in
                </Button>
              </>
            )}
          </div>
        ) : activeTab === "verify" ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-5 text-center">
              <Mail className="text-primary/80 size-8" />
              <p className="text-sm text-white/70">
                A verification email was sent to{" "}
                {verifyEmail ? (
                  <span className="font-medium text-white/90">{verifyEmail}</span>
                ) : (
                  "your inbox"
                )}
                . Open the link in that email to finish signing in. This tab will continue
                automatically once the link is confirmed.
              </p>
            </div>

            {resendCooldown > 0 && resendBannerMode && (
              <Alert
                className={
                  resendBannerMode === "sent"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-amber-500/40 bg-amber-500/10"
                }
              >
                {resendBannerMode === "sent" ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <Mail className="size-4 text-amber-300" />
                )}
                <AlertDescription
                  className={resendBannerMode === "sent" ? "text-primary/90" : "text-amber-200"}
                >
                  {resendBannerMode === "sent"
                    ? `Verification email sent. You can resend again in ${resendCooldown}s.`
                    : `A verification email was sent recently. You can resend again in ${resendCooldown}s.`}
                </AlertDescription>
              </Alert>
            )}

            {verifyError && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="size-4" />
                <AlertDescription>{formatFriendlyError(verifyError)}</AlertDescription>
              </Alert>
            )}

            {"error" in (resendState ?? {}) && (resendState as { error: string } | null)?.error && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="size-4" />
                <AlertDescription>
                  {formatFriendlyError((resendState as { error: string }).error)}
                </AlertDescription>
              </Alert>
            )}

            {"providerLimited" in (resendState ?? {}) &&
              (resendState as { providerLimited: true; message: string } | null)?.message && (
                <Alert className="border-amber-500/40 bg-amber-500/10">
                  <Mail className="size-4 text-amber-300" />
                  <AlertDescription className="text-amber-200">
                    {(resendState as { providerLimited: true; message: string }).message}
                  </AlertDescription>
                </Alert>
              )}

            <form action={resendAction_}>
              {lockedVerifyEmail ? (
                <input type="hidden" name="email" value={verifyEmail} />
              ) : (
                <div className="mb-2.5 space-y-1.5">
                  <Label htmlFor="verify-email" className="text-xs font-medium text-white/60">
                    Your email
                  </Label>
                  <Input
                    id="verify-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={verifyEmail}
                    onChange={(e) => setVerifyEmail(e.target.value)}
                    disabled={isResendPending}
                    className={inputClassName}
                  />
                </div>
              )}
              {verifyFlow && <input type="hidden" name="flow" value={verifyFlow} />}
              <Button
                type="submit"
                disabled={isResendPending || resendCooldown > 0}
                aria-disabled={isResendPending || resendCooldown > 0}
                className={primaryButtonClassName}
              >
                {isResendPending ? (
                  <>
                    <Spinner className="size-4" />
                    Sending...
                  </>
                ) : resendCooldown > 0 ? (
                  `Resend again in ${resendCooldown}s`
                ) : (
                  "Resend verification email"
                )}
              </Button>
            </form>

            <Button
              variant="ghost"
              onClick={() => switchTab("signin")}
              className="h-9 w-full border-white/15 text-white/60 hover:bg-white/5 hover:text-white/80"
            >
              ← Back to Sign in
            </Button>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => switchTab(value as "signin" | "signup")}
            className="w-full gap-2"
          >
            <TabsList className="grid h-9 w-full grid-cols-2 border border-white/10 bg-white/5 p-1">
              <TabsTrigger
                value="signin"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-sm text-white/60 data-[state=active]:border-transparent data-[state=active]:shadow-none"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-sm text-white/60 data-[state=active]:border-transparent data-[state=active]:shadow-none"
              >
                Create Account
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-0 min-h-[240px] sm:min-h-[252px]">
              <form
                action={signInAction_}
                onSubmit={() => {
                  setGuestError(null);
                  setPasswordMismatchError(null);
                }}
                className="space-y-2.5"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email" className="text-xs font-medium text-white/60">
                    Email
                  </Label>
                  <Input
                    id="signin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signInEmail}
                    onChange={(event) => setSignInEmail(event.target.value)}
                    disabled={isAnyPending}
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-password" className="text-xs font-medium text-white/60">
                    Password
                  </Label>
                  <Input
                    id="signin-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={signInPassword}
                    onChange={(event) => setSignInPassword(event.target.value)}
                    disabled={isAnyPending}
                    className={inputClassName}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(signInEmail);
                      setPasswordResetComplete(false);
                      setActiveTab("forgot");
                      setVerifyFlow(undefined);
                      const nextParams = new URLSearchParams(searchParams.toString());
                      nextParams.set("tab", "forgot");
                      nextParams.delete("email");
                      nextParams.delete("flow");
                      replaceAuthUrl(nextParams);
                    }}
                    className="text-xs text-white/45 hover:text-emerald-400 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                {unverifiedEmail && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <AlertCircle className="size-4 text-amber-400" />
                    <AlertDescription className="text-amber-300">
                      Email not verified.{" "}
                      <button
                        type="button"
                        onClick={() => goToVerify(unverifiedEmail)}
                        className="font-medium underline hover:text-amber-200"
                      >
                        Resend verification email
                      </button>
                    </AlertDescription>
                  </Alert>
                )}

                {signInError && (
                  <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{signInError}</AlertDescription>
                  </Alert>
                )}

                {passwordResetComplete && (
                  <Alert className="border-primary/30 bg-primary/10 text-primary">
                    <CheckCircle2 className="size-4" />
                    <AlertDescription className="text-primary/90">
                      Password reset successful. Sign in again with your new password.
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  disabled={isAnyPending}
                  aria-disabled={isAnyPending}
                  className={primaryButtonClassName}
                >
                  {isSignInPending ? (
                    <>
                      <Spinner className="size-4" />
                      Signing in...
                    </>
                  ) : (
                    "Sign in"
                  )}
                </Button>

                <p className="text-center text-xs text-white/45">
                  Don&apos;t have an account?{" "}
                  <Link
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      switchTab("signup");
                    }}
                    className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    Create one
                  </Link>
                </p>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-0 min-h-[240px] sm:min-h-[252px]">
              <form
                action={createAccountAction}
                onSubmit={(event) => {
                  setGuestError(null);
                  if (signUpPassword !== confirmPassword) {
                    event.preventDefault();
                    setPasswordMismatchError(
                      "Password mismatch. Please make sure both passwords match."
                    );
                    return;
                  }
                  setPasswordMismatchError(null);
                }}
                className="space-y-2.5"
              >
                {isGuestSession && (
                  <Alert className="border-primary/30 bg-primary/10 text-primary">
                    <CheckCircle2 className="size-4" />
                    <AlertDescription className="text-primary/90">
                      You&apos;re upgrading your current guest session. Existing runs and settings
                      stay on this account.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="signup-email" className="text-xs font-medium text-white/60">
                    Email
                  </Label>
                  <Input
                    id="signup-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signUpEmail}
                    onChange={(event) => setSignUpEmail(event.target.value)}
                    disabled={isAnyPending}
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password" className="text-xs font-medium text-white/60">
                    Password
                  </Label>
                  <Input
                    id="signup-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={signUpPassword}
                    onChange={(event) => setSignUpPassword(event.target.value)}
                    disabled={isAnyPending}
                    className={inputClassName}
                  />
                  <p className="text-[11px] text-white/40">
                    8+ characters, one uppercase letter, one special character
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="signup-confirm-password"
                    className="text-xs font-medium text-white/60"
                  >
                    Confirm Password
                  </Label>
                  <Input
                    id="signup-confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isAnyPending}
                    className={inputClassName}
                  />
                </div>

                {(passwordMismatchError || signUpError) && (
                  <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{passwordMismatchError ?? signUpError}</AlertDescription>
                  </Alert>
                )}

                {showSignInInsteadButton && !passwordMismatchError && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={switchToSignInTab}
                    className="hover:border-primary/40 hover:bg-primary/10 hover:text-primary h-9 w-full border-white/15 bg-transparent text-white/75"
                  >
                    Sign in instead
                  </Button>
                )}

                <Button
                  type="submit"
                  disabled={isAnyPending}
                  aria-disabled={isAnyPending}
                  className={primaryButtonClassName}
                >
                  {isCreateAccountPending ? (
                    <>
                      <Spinner className="size-4" />
                      {isGuestSession ? "Upgrading account..." : "Creating account..."}
                    </>
                  ) : isGuestSession ? (
                    "Create account and keep my runs"
                  ) : (
                    "Create account"
                  )}
                </Button>

                <p className="text-center text-xs text-white/45">
                  Already have an account?{" "}
                  <Link
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      switchTab("signin");
                    }}
                    className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {activeTab !== "verify" && activeTab !== "forgot" && !isGuestSession && (
          <>
            {guestError && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="size-4" />
                <AlertDescription>{guestError}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              onClick={handleGuest}
              disabled={isAnyPending}
              aria-disabled={isAnyPending}
              className="hover:border-primary/40 hover:bg-primary/10 hover:text-primary h-9 w-full border-white/15 bg-transparent text-white/70"
            >
              {isGuestPending ? (
                <>
                  <Spinner className="size-4" />
                  Setting up guest session...
                </>
              ) : (
                "Continue as Guest"
              )}
            </Button>
          </>
        )}
      </div>

      <p className="mt-auto translate-y-8 text-[11px] text-white/45">
        FactorLab • Quant Research Dashboard
        <br />
        Not financial advice.
      </p>
    </div>
  );
}
