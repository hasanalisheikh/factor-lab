"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import { PasswordResetLink } from "./password-reset-link";

import type { Dispatch, SetStateAction } from "react";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { FormAction } from "./types";

type SignInFormProps = {
  goToVerify: (email: string, flow?: VerificationFlow) => void;
  inputClassName: string;
  isAnyPending: boolean;
  isSignInPending: boolean;
  onCreateAccount: () => void;
  onForgotPassword: () => void;
  passwordResetComplete: boolean;
  primaryButtonClassName: string;
  setGuestError: Dispatch<SetStateAction<string | null>>;
  setPasswordMismatchError: Dispatch<SetStateAction<string | null>>;
  setSignInEmail: Dispatch<SetStateAction<string>>;
  setSignInPassword: Dispatch<SetStateAction<string>>;
  signInAction: FormAction;
  signInEmail: string;
  signInError: string | null;
  signInPassword: string;
  unverifiedEmail: string | null;
};

export function SignInForm({
  goToVerify,
  inputClassName,
  isAnyPending,
  isSignInPending,
  onCreateAccount,
  onForgotPassword,
  passwordResetComplete,
  primaryButtonClassName,
  setGuestError,
  setPasswordMismatchError,
  setSignInEmail,
  setSignInPassword,
  signInAction,
  signInEmail,
  signInError,
  signInPassword,
  unverifiedEmail,
}: SignInFormProps) {
  return (
    <form
      action={signInAction}
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
        <PasswordResetLink onClick={onForgotPassword} />
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
            onCreateAccount();
          }}
          className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
