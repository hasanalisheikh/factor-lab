"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CreateAccountForm } from "./create-account-form";
import { SignInForm } from "./sign-in-form";

import type { Dispatch, SetStateAction } from "react";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthTab, FormAction } from "./types";

export type AuthTabsProps = {
  activeTab: AuthTab;
  confirmPassword: string;
  createAccountAction: FormAction;
  goToVerify: (email: string, flow?: VerificationFlow) => void;
  inputClassName: string;
  isAnyPending: boolean;
  isCreateAccountPending: boolean;
  isGuestSession: boolean;
  isSignInPending: boolean;
  onCreateAccount: () => void;
  onForgotPassword: () => void;
  passwordMismatchError: string | null;
  passwordResetComplete: boolean;
  primaryButtonClassName: string;
  setConfirmPassword: Dispatch<SetStateAction<string>>;
  setGuestError: Dispatch<SetStateAction<string | null>>;
  setPasswordMismatchError: Dispatch<SetStateAction<string | null>>;
  setSignInEmail: Dispatch<SetStateAction<string>>;
  setSignInPassword: Dispatch<SetStateAction<string>>;
  setSignUpEmail: Dispatch<SetStateAction<string>>;
  setSignUpPassword: Dispatch<SetStateAction<string>>;
  showSignInInsteadButton: boolean;
  signInAction: FormAction;
  signInEmail: string;
  signInError: string | null;
  signInPassword: string;
  signUpEmail: string;
  signUpError: string | null;
  signUpPassword: string;
  switchTab: (tab: "signin" | "signup") => void;
  switchToSignInTab: () => void;
  unverifiedEmail: string | null;
};

export function AuthTabs({
  activeTab,
  confirmPassword,
  createAccountAction,
  goToVerify,
  inputClassName,
  isAnyPending,
  isCreateAccountPending,
  isGuestSession,
  isSignInPending,
  onCreateAccount,
  onForgotPassword,
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
  signInAction,
  signInEmail,
  signInError,
  signInPassword,
  signUpEmail,
  signUpError,
  signUpPassword,
  switchTab,
  switchToSignInTab,
  unverifiedEmail,
}: AuthTabsProps) {
  return (
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
        <SignInForm
          goToVerify={goToVerify}
          inputClassName={inputClassName}
          isAnyPending={isAnyPending}
          isSignInPending={isSignInPending}
          onCreateAccount={onCreateAccount}
          onForgotPassword={onForgotPassword}
          passwordResetComplete={passwordResetComplete}
          primaryButtonClassName={primaryButtonClassName}
          setGuestError={setGuestError}
          setPasswordMismatchError={setPasswordMismatchError}
          setSignInEmail={setSignInEmail}
          setSignInPassword={setSignInPassword}
          signInAction={signInAction}
          signInEmail={signInEmail}
          signInError={signInError}
          signInPassword={signInPassword}
          unverifiedEmail={unverifiedEmail}
        />
      </TabsContent>

      <TabsContent value="signup" className="mt-0 min-h-[240px] sm:min-h-[252px]">
        <CreateAccountForm
          confirmPassword={confirmPassword}
          createAccountAction={createAccountAction}
          inputClassName={inputClassName}
          isAnyPending={isAnyPending}
          isCreateAccountPending={isCreateAccountPending}
          isGuestSession={isGuestSession}
          onSignIn={() => switchTab("signin")}
          passwordMismatchError={passwordMismatchError}
          primaryButtonClassName={primaryButtonClassName}
          setConfirmPassword={setConfirmPassword}
          setGuestError={setGuestError}
          setPasswordMismatchError={setPasswordMismatchError}
          setSignUpEmail={setSignUpEmail}
          setSignUpPassword={setSignUpPassword}
          showSignInInsteadButton={showSignInInsteadButton}
          signUpEmail={signUpEmail}
          signUpError={signUpError}
          signUpPassword={signUpPassword}
          switchToSignInTab={switchToSignInTab}
        />
      </TabsContent>
    </Tabs>
  );
}
