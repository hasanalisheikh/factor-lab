"use client";

import { AlertCircle, CheckCircle2, Mail } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import type { ForgotPasswordViewProps } from "./types";

export function ForgotPasswordView({
  forgotAction,
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
}: ForgotPasswordViewProps) {
  if (shouldShowForgotSuccessState) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-5 text-center">
          <Mail className="text-primary/80 size-8" />
          <p className="text-sm text-white/70">
            If an account exists for{" "}
            <span className="font-medium text-white/90">{forgotEmailValue}</span>, you&apos;ll
            receive a password reset email shortly.
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

        <form action={forgotAction}>
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
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
      <form action={forgotAction} className="space-y-2.5">
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
    </div>
  );
}
