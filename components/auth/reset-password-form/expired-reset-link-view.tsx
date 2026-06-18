import Link from "next/link";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import type { Dispatch, SetStateAction } from "react";

type ExpiredResetLinkViewProps = {
  inputClassName: string;
  isResendPending: boolean;
  lockedResetEmail?: string;
  primaryButtonClassName: string;
  resendAction: (formData: FormData) => void;
  resendBannerMode: "sent" | "cooldown" | null;
  resendCooldown: number;
  resendError: string | null;
  resendProviderLimitedMessage: string | null;
  resetEmail: string;
  resetEmailValue: string;
  sessionError: string | null;
  setResetEmail: Dispatch<SetStateAction<string>>;
};

export function ExpiredResetLinkView({
  inputClassName,
  isResendPending,
  lockedResetEmail,
  primaryButtonClassName,
  resendAction,
  resendBannerMode,
  resendCooldown,
  resendError,
  resendProviderLimitedMessage,
  resetEmail,
  resetEmailValue,
  sessionError,
  setResetEmail,
}: ExpiredResetLinkViewProps) {
  return (
    <div className="space-y-3">
      <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
        <AlertCircle className="size-4" />
        <AlertDescription>{sessionError}</AlertDescription>
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

      <form action={resendAction} className="space-y-2.5">
        {lockedResetEmail ? (
          <input type="hidden" name="email" value={resetEmailValue} />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="expired-reset-email" className="text-xs font-medium text-white/60">
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
  );
}
