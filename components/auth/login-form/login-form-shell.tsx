"use client";

import { AlertCircle } from "lucide-react";

import { Logo } from "@/components/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { AuthTabs } from "./auth-tabs";
import { ForgotPasswordView } from "./forgot-password-view";
import { GuestButton } from "./guest-button";
import { VerifyEmailView } from "./verify-email-view";

import type { LoginFormShellProps } from "./types";

function getHeading(activeTab: LoginFormShellProps["activeTab"], isGuestSession: boolean) {
  if (activeTab === "signin") return "Sign in";
  if (activeTab === "signup") {
    return isGuestSession ? "Create account and keep my runs" : "Create account";
  }
  if (activeTab === "forgot") return "Reset password";
  return "Verify your email";
}

export function LoginFormShell({
  activeTab,
  authError,
  authTabs,
  forgotView,
  guest,
  isGuestSession,
  verifyView,
}: LoginFormShellProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="absolute top-5 left-5 z-10 flex items-center gap-2">
        <Logo size={26} wordmarkClassName="text-[24px]" />
      </div>

      <div className="space-y-2.5 pt-14">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight text-white/90">
            {getHeading(activeTab, isGuestSession)}
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
          <ForgotPasswordView {...forgotView} />
        ) : activeTab === "verify" ? (
          <VerifyEmailView {...verifyView} />
        ) : (
          <AuthTabs {...authTabs} />
        )}

        {activeTab !== "verify" && activeTab !== "forgot" && !isGuestSession && (
          <GuestButton {...guest} />
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
