"use client";

import { AlertCircle, CheckCircle2, Mail } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import type { VerifyEmailViewProps } from "./types";

export function VerifyEmailView({
  formatFriendlyError,
  inputClassName,
  isResendPending,
  lockedVerifyEmail,
  primaryButtonClassName,
  resendAction,
  resendBannerMode,
  resendCooldown,
  resendError,
  resendProviderLimitedMessage,
  setVerifyEmail,
  switchTab,
  verifyEmail,
  verifyError,
  verifyFlow,
}: VerifyEmailViewProps) {
  return (
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
          . Open the link in that email to finish signing in. This tab will continue automatically
          once the link is confirmed.
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

      {resendError && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertCircle className="size-4" />
          <AlertDescription>{formatFriendlyError(resendError)}</AlertDescription>
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

      <form action={resendAction}>
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
  );
}
