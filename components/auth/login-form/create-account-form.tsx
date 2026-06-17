"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { FormAction } from "./types";

type CreateAccountFormProps = {
  confirmPassword: string;
  createAccountAction: FormAction;
  inputClassName: string;
  isAnyPending: boolean;
  isCreateAccountPending: boolean;
  isGuestSession: boolean;
  onSignIn: () => void;
  passwordMismatchError: string | null;
  primaryButtonClassName: string;
  setConfirmPassword: Dispatch<SetStateAction<string>>;
  setGuestError: Dispatch<SetStateAction<string | null>>;
  setPasswordMismatchError: Dispatch<SetStateAction<string | null>>;
  setSignUpEmail: Dispatch<SetStateAction<string>>;
  setSignUpPassword: Dispatch<SetStateAction<string>>;
  showSignInInsteadButton: boolean;
  signUpEmail: string;
  signUpError: string | null;
  signUpPassword: string;
  switchToSignInTab: () => void;
};

export function CreateAccountForm({
  confirmPassword,
  createAccountAction,
  inputClassName,
  isAnyPending,
  isCreateAccountPending,
  isGuestSession,
  onSignIn,
  passwordMismatchError,
  primaryButtonClassName,
  setConfirmPassword,
  setGuestError,
  setPasswordMismatchError,
  setSignUpEmail,
  setSignUpPassword,
  showSignInInsteadButton,
  signUpEmail,
  signUpError,
  signUpPassword,
  switchToSignInTab,
}: CreateAccountFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setGuestError(null);
    if (signUpPassword !== confirmPassword) {
      event.preventDefault();
      setPasswordMismatchError("Password mismatch. Please make sure both passwords match.");
      return;
    }
    setPasswordMismatchError(null);
  }

  return (
    <form action={createAccountAction} onSubmit={handleSubmit} className="space-y-2.5">
      {isGuestSession && (
        <Alert className="border-primary/30 bg-primary/10 text-primary">
          <CheckCircle2 className="size-4" />
          <AlertDescription className="text-primary/90">
            You&apos;re upgrading your current guest session. Existing runs and settings stay on
            this account.
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
        <Label htmlFor="signup-confirm-password" className="text-xs font-medium text-white/60">
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
            onSignIn();
          }}
          className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
