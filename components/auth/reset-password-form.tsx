"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { resetPasswordAction, type ResetPasswordState } from "@/app/actions/auth";
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
import { createClient } from "@/lib/supabase/client";

type ResetCompletionState =
  | { status: "idle"; error: null }
  | { status: "pending"; error: null }
  | { status: "success"; error: null }
  | { status: "failed"; error: string };

export function ResetPasswordForm() {
  const [formState, action_, isPending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    null
  );
  const [sessionState, setSessionState] = useState<BrowserSessionHydrationState>({
    status: "pending",
    error: null,
  });
  const [completionState, setCompletionState] = useState<ResetCompletionState>({
    status: "idle",
    error: null,
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);

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
    if (!formState || !("success" in formState) || completionState.status !== "idle") {
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    async function finalizeReset() {
      setCompletionState({ status: "pending", error: null });

      const { error } = await finalizePasswordResetSession(supabase);
      if (cancelled) {
        return;
      }

      if (error) {
        setCompletionState({
          status: "failed",
          error:
            "Your password was updated, but we couldn't finish signing you out. Close this tab, then return to the login page and sign in again.",
        });
        return;
      }

      setPassword("");
      setConfirmPassword("");
      broadcastPasswordResetComplete();
      setCompletionState({ status: "success", error: null });
    }

    void finalizeReset();

    return () => {
      cancelled = true;
    };
  }, [completionState.status, formState]);

  const inputClassName =
    "h-9 border-white/10 bg-white/5 text-white/90 placeholder:text-white/45 focus-visible:border-primary/70 focus-visible:ring-primary/40";
  const primaryButtonClassName =
    "h-9 w-full bg-primary text-primary-foreground shadow-[0_14px_28px_-14px_rgba(40,199,130,0.7)] hover:bg-primary/90";
  const actionError = formState && "error" in formState ? formState.error : null;
  const formError = mismatchError ?? actionError;

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

        {sessionState.status === "pending" || completionState.status === "pending" ? (
          <div className="space-y-3">
            <div className="bg-primary/10 text-primary mx-auto flex h-10 w-10 items-center justify-center rounded-full">
              <Spinner className="size-4" />
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-base font-semibold tracking-tight text-white/90">
                {sessionState.status === "pending"
                  ? "Preparing reset session..."
                  : "Finishing password reset..."}
              </h2>
              <p className="text-sm text-white/60">
                {sessionState.status === "pending"
                  ? "We're validating your reset link so you can choose a new password."
                  : "We're signing you out now so you can return to your original sign-in tab."}
              </p>
            </div>
          </div>
        ) : sessionState.status === "failed" ? (
          <div className="space-y-3">
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertCircle className="size-4" />
              <AlertDescription>{sessionState.error}</AlertDescription>
            </Alert>
            <p className="text-xs text-white/55">
              Go back to{" "}
              <Link
                href="/login?tab=forgot"
                className="text-primary underline-offset-2 hover:underline"
              >
                reset password
              </Link>{" "}
              and request a new link.
            </p>
          </div>
        ) : completionState.status === "success" ? (
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
        ) : completionState.status === "failed" ? (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
            <AlertCircle className="size-4" />
            <AlertDescription>{completionState.error}</AlertDescription>
          </Alert>
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
