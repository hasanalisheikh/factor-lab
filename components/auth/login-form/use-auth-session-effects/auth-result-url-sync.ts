import { useEffect } from "react";

import { getRemainingResendCooldownSeconds } from "@/lib/auth/resend-verification";

import { getSentAtForCooldown } from "../types";
import type { ForgotPasswordState, ResendState } from "@/app/actions/auth";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthTab } from "../types";

type UrlRouter = {
  replace: (href: string) => void;
};

export function useAuthResultUrlSync({
  activeTab,
  forgotEmail,
  forgotSentAt,
  forgotState,
  pathname,
  resendState,
  router,
  searchEmail,
  searchFlow,
  searchParams,
  searchSentAt,
  searchTab,
  verifyEmail,
  verifyFlow,
}: {
  activeTab: AuthTab;
  forgotEmail: string;
  forgotSentAt?: number;
  forgotState: ForgotPasswordState;
  pathname: string;
  resendState: ResendState;
  router: UrlRouter;
  searchEmail?: string;
  searchFlow?: string;
  searchParams: URLSearchParams;
  searchSentAt?: number;
  searchTab?: AuthTab;
  verifyEmail: string;
  verifyFlow?: VerificationFlow;
}) {
  useEffect(() => {
    if (activeTab !== "verify" || !verifyEmail || !resendState) {
      return;
    }

    if (!("success" in resendState) && !("rateLimited" in resendState)) {
      return;
    }

    const currentCooldown =
      searchSentAt === undefined ? undefined : getRemainingResendCooldownSeconds(searchSentAt);
    const searchFlowMatches = (searchFlow ?? undefined) === verifyFlow;
    const searchAlreadyMatchesVerifyState =
      searchTab === "verify" &&
      searchEmail === verifyEmail &&
      searchFlowMatches &&
      currentCooldown !== undefined &&
      currentCooldown >= resendState.cooldownSeconds - 1;

    if (searchAlreadyMatchesVerifyState) {
      return;
    }

    const sentAt =
      "success" in resendState ? Date.now() : getSentAtForCooldown(resendState.cooldownSeconds);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "verify");
    nextParams.set("email", verifyEmail);
    if (verifyFlow) {
      nextParams.set("flow", verifyFlow);
    } else {
      nextParams.delete("flow");
    }
    nextParams.set("sent_at", String(sentAt));
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [
    activeTab,
    pathname,
    resendState,
    router,
    searchEmail,
    searchFlow,
    searchParams,
    searchSentAt,
    searchTab,
    verifyEmail,
    verifyFlow,
  ]);

  useEffect(() => {
    const trimmedForgotEmail = forgotEmail.trim();
    if (activeTab !== "forgot" || !trimmedForgotEmail || !forgotState) {
      return;
    }

    if (!("success" in forgotState) && !("rateLimited" in forgotState)) {
      return;
    }

    const currentCooldown =
      forgotSentAt === undefined ? undefined : getRemainingResendCooldownSeconds(forgotSentAt);
    const searchAlreadyMatchesForgotState =
      searchTab === "forgot" &&
      searchEmail === trimmedForgotEmail &&
      currentCooldown !== undefined &&
      currentCooldown >= forgotState.cooldownSeconds - 1;

    if (searchAlreadyMatchesForgotState) {
      return;
    }

    const sentAt =
      "success" in forgotState
        ? forgotState.sentAt
        : getSentAtForCooldown(forgotState.cooldownSeconds);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "forgot");
    nextParams.set("email", trimmedForgotEmail);
    nextParams.delete("flow");
    nextParams.delete("error");
    nextParams.set("sent_at", String(sentAt));
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [
    activeTab,
    forgotEmail,
    forgotSentAt,
    forgotState,
    pathname,
    router,
    searchEmail,
    searchParams,
    searchTab,
  ]);
}
