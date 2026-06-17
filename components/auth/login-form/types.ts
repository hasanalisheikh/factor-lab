import { RESEND_VERIFICATION_COOLDOWN_SECONDS } from "@/lib/auth/resend-verification";

import type { Dispatch, SetStateAction } from "react";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthTabsProps } from "./auth-tabs";
import type { GuestButtonProps } from "./guest-button";

export type AuthTab = "signin" | "signup" | "verify" | "forgot";
export type AuthBannerMode = "sent" | "cooldown" | null;
export type FormAction = (formData: FormData) => void;

export type LoginFormProps = {
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
};

export function normalizeAuthTab(tab: string | null | undefined): AuthTab | undefined {
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

export function parseSentAt(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const sentAt = Number(value);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : undefined;
}

export function getSentAtForCooldown(cooldownSeconds: number) {
  return Date.now() - Math.max(0, RESEND_VERIFICATION_COOLDOWN_SECONDS - cooldownSeconds) * 1000;
}

export type ForgotPasswordViewProps = {
  forgotAction: FormAction;
  forgotBannerMode: AuthBannerMode;
  forgotCooldown: number;
  forgotEmail: string;
  forgotEmailValue: string;
  forgotError?: string;
  forgotInlineError: string | null;
  forgotProviderLimitedMessage: string | null;
  inputClassName: string;
  isForgotPending: boolean;
  primaryButtonClassName: string;
  setForgotEmail: Dispatch<SetStateAction<string>>;
  shouldShowForgotSuccessState: boolean;
  switchTab: (tab: "signin" | "signup") => void;
};

export type VerifyEmailViewProps = {
  formatFriendlyError: (error: string) => string;
  inputClassName: string;
  isResendPending: boolean;
  lockedVerifyEmail?: string;
  primaryButtonClassName: string;
  resendAction: FormAction;
  resendBannerMode: AuthBannerMode;
  resendCooldown: number;
  resendError: string | null;
  resendProviderLimitedMessage: string | null;
  setVerifyEmail: Dispatch<SetStateAction<string>>;
  switchTab: (tab: "signin" | "signup") => void;
  verifyEmail: string;
  verifyError?: string;
  verifyFlow?: VerificationFlow;
};

export type LoginFormShellProps = {
  activeTab: AuthTab;
  authError?: string;
  isGuestSession: boolean;
  authTabs: AuthTabsProps;
  forgotView: ForgotPasswordViewProps;
  guest: GuestButtonProps;
  verifyView: VerifyEmailViewProps;
};
