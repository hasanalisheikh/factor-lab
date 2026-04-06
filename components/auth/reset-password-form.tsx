"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import {
  forgotPasswordAction,
  resetPasswordAction,
  type ForgotPasswordState,
  type ResetPasswordState,
} from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  hydrateBrowserSession,
  type BrowserSessionHydrationState,
} from "@/lib/auth/client-session-hydration";
import { broadcastPasswordResetComplete } from "@/lib/auth/password-reset-sync";
import { finalizePasswordResetSession } from "@/lib/auth/password-reset-session";
import {
  getRemainingResendCooldownSeconds,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";
import { createClient } from "@/lib/supabase/client";

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

export function ResetPasswordForm({
  initialEmail,
  initialSentAt,
}: {
  initialEmail?: string;
  initialSentAt?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formState, action_, isPending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    null
  );
  const [resendState, resendAction_, isResendPending] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordAction, null);
  const [sessionState, setSessionState] = useState<BrowserSessionHydrationState>({
    status: "pending",
    error: null,
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState(initialEmail ?? "");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendBannerMode, setResendBannerMode] = useState<"sent" | "cooldown" | null>(null);
  const hasHandledSuccessfulReset = useRef(false);
  const isResetSuccessful = Boolean(formState && "success" in formState);
  const searchEmail = searchParams.get("email") ?? undefined;
  const searchSentAt = parseSentAt(searchParams.get("sent_at"));
  const effectiveSentAt = searchSentAt ?? initialSentAt;
  const lockedResetEmail = searchEmail ?? initialEmail;
  const resetEmailValue = (lockedResetEmail ?? resetEmail).trim();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function hydrateSession() {
      const result = await hydrateBrowserSession(
        supabase,
        "Reset link expired. Please request a new password reset email."
      );

      if (!cancelled) {
        setSessionState(result);
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isResetSuccessful || hasHandledSuccessfulReset.current) {
      return;
    }

    hasHandledSuccessfulReset.current = true;
    broadcastPasswordResetComplete();

    const supabase = createClient();
    void finalizePasswordResetSession(supabase);
  }, [isResetSuccessful]);

  useEffect(() => {
    if (searchEmail === undefined) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResetEmail(searchEmail);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [searchEmail]);

  useEffect(() => {
    if (sessionState.status !== "failed" || effectiveSentAt === undefined) {
      return;
    }

    const remaining = getRemainingResendCooldownSeconds(effectiveSentAt);
    if (remaining <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(current, remaining));
      setResendBannerMode((current) => current ?? "cooldown");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [effectiveSentAt, sessionState.status]);

  useEffect(() => {
    if (!resendState) {
      return;
    }

    if ("success" in resendState || "rateLimited" in resendState) {
      const timeoutId = window.setTimeout(() => {
        setResendCooldown(resendState.cooldownSeconds);
        setResendBannerMode("success" in resendState ? "sent" : "cooldown");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [resendState]);

  useEffect(() => {
    if (sessionState.status !== "failed" || !resetEmailValue || !resendState) {
      return;
    }

    if (!("success" in resendState) && !("rateLimited" in resendState)) {
      return;
    }

    const currentCooldown =
      effectiveSentAt === undefined
        ? undefined
        : getRemainingResendCooldownSeconds(effectiveSentAt);
    const searchAlreadyMatchesResendState =
      searchEmail === resetEmailValue &&
      currentCooldown !== undefined &&
      currentCooldown >= resendState.cooldownSeconds - 1;

    if (searchAlreadyMatchesResendState) {
      return;
    }

    const sentAt =
      "success" in resendState
        ? resendState.sentAt
        : getSentAtForCooldown(resendState.cooldownSeconds);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("email", resetEmailValue);
    nextParams.set("sent_at", String(sentAt));
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [
    effectiveSentAt,
    pathname,
    resendState,
    resetEmailValue,
    router,
    searchEmail,
    searchParams,
    sessionState.status,
  ]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(() => setResendCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  const inputClassName =
    "h-9 border-white/10 bg-white/5 text-white/90 placeholder:text-white/45 focus-visible:border-primary/70 focus-visible:ring-primary/40";
  const primaryButtonClassName =
    "h-9 w-full bg-primary text-primary-foreground shadow-[0_14px_28px_-14px_rgba(40,199,130,0.7)] hover:bg-primary/90";
  const actionError = formState && "error" in formState ? formState.error : null;
  const formError = mismatchError ?? actionError;
  const resendError = resendState && "error" in resendState ? resendState.error : null;
  const resendProviderLimitedMessage =
    resendState && "providerLimited" in resendState ? resendState.message : null;

  return (
    <Card className="bg-card/95 border-white/10 p-6 shadow-[0_28px_75px_-36px_rgba(0,0,0,0.95)]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Logo size={26} wordmarkClassName="text-[24px]" />
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight text-white/90">Set new password</h1>
            <p className="text-sm text-white/60">Choose a strong password for your account.</p>
          </div>
        </div>

        {sessionState.status === "pending" ? (
          <div className="space-y-3">
            <div className="bg-primary/10 text-primary mx-auto flex h-10 w-10 items-center justify-center rounded-full">
              <Spinner className="size-4" />
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-base font-semibold tracking-tight text-white/90">
                Preparing reset session...
              </h2>
              <p className="text-sm text-white/60">
                We&apos;re validating your reset link so you can choose a new password.
              </p>
            </div>
          </div>
        ) : sessionState.status === "failed" ? (
          <div className="space-y-3">
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertCircle className="size-4" />
              <AlertDescription>{sessionState.error}</AlertDescription>
            </Alert>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-5 text-center">
              <Mail className="text-primary/80 size-8" />
              <p className="text-sm text-white/70">
                {resetEmailValue ? (
                  <>
                    We can send a fresh password reset email to{" "}
                    <span className="font-medium text-white/90">{resetEmailValue}</span>.
                  </>
                ) : (
                  "Enter your email below and we'll send you a fresh password reset link."
                )}
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
                    ? `Password reset email sent. You can resend again in ${resendCooldown}s.`
                    : `A password reset email was sent recently. You can resend again in ${resendCooldown}s.`}
                </AlertDescription>
              </Alert>
            )}

            {resendError && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="size-4" />
                <AlertDescription>{resendError}</AlertDescription>
              </Alert>
            )}

            {resendProviderLimitedMessage && (
              <Alert className="border-amber-500/40 bg-amber-500/10">
                <Mail className="size-4 text-amber-300" />
                <AlertDescription className="text-amber-200">
                  {resendProviderLimitedMessage}
                </AlertDescription>
              </Alert>
            )}

            <form action={resendAction_} className="space-y-2.5">
              {lockedResetEmail ? (
                <input type="hidden" name="email" value={resetEmailValue} />
              ) : (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="expired-reset-email"
                    className="text-xs font-medium text-white/60"
                  >
                    Email
                  </Label>
                  <Input
                    id="expired-reset-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    disabled={isResendPending}
                    className={inputClassName}
                  />
                </div>
              )}
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
                  "Resend reset email"
                )}
              </Button>
            </form>

            <p className="text-xs text-white/55">
              Or go back to{" "}
              <Link
                href={
                  resetEmailValue
                    ? `/login?tab=forgot&email=${encodeURIComponent(resetEmailValue)}`
                    : "/login?tab=forgot"
                }
                className="text-primary underline-offset-2 hover:underline"
              >
                reset password
              </Link>
              .
            </p>
          </div>
        ) : isResetSuccessful ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-4 py-5 text-center">
              <CheckCircle2 className="size-8 text-emerald-300" />
              <p className="text-sm text-white/80">
                Password reset successful. Close this tab and return to your original login window.
              </p>
            </div>
            <p className="text-center text-xs text-white/55">
              Your original tab will ask you to sign in again with the new password.
            </p>
          </div>
        ) : (
          <form
            action={action_}
            onSubmit={(event) => {
              if (password !== confirmPassword) {
                event.preventDefault();
                setMismatchError("Passwords do not match.");
                return;
              }
              setMismatchError(null);
            }}
            className="space-y-2.5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="reset-password" className="text-xs font-medium text-white/60">
                New password
              </Label>
              <Input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
                className={inputClassName}
              />
              <p className="text-[11px] text-white/40">
                8+ characters, one uppercase letter, one special character
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm-password" className="text-xs font-medium text-white/60">
                Confirm new password
              </Label>
              <Input
                id="reset-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isPending}
                className={inputClassName}
              />
            </div>

            {formError && (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                <AlertCircle className="size-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={isPending}
              aria-disabled={isPending}
              className={primaryButtonClassName}
            >
              {isPending ? (
                <>
                  <Spinner className="size-4" />
                  Updating password...
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        )}

        <p className="mt-4 text-xs text-white/45">
          FactorLab • Quant Research Dashboard
          <br />
          Not financial advice.
        </p>
      </div>
    </Card>
  );
}
