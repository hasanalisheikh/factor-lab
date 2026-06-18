import { useEffect, useRef } from "react";

import { subscribeToEmailVerificationComplete } from "@/lib/auth/email-verification-sync";
import { getRemainingResendCooldownSeconds } from "@/lib/auth/resend-verification";
import { createClient } from "@/lib/supabase/client";

import type { ForgotPasswordState, ResendState } from "@/app/actions/auth";
import type { Dispatch, SetStateAction } from "react";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthBannerMode, AuthTab, LoginFormProps } from "./types";

export { useAuthResultUrlSync } from "./use-auth-session-effects/auth-result-url-sync";
export { usePasswordResetCompleteSync } from "./use-auth-session-effects/password-reset-complete-sync";

type AuthRouter = {
  refresh: () => void;
  replace: (href: string) => void;
};

export function useValidateGuestSession({
  sessionUser,
  setActiveTab,
  setResolvedIsGuest,
}: {
  sessionUser: LoginFormProps["sessionUser"];
  setActiveTab: Dispatch<SetStateAction<AuthTab>>;
  setResolvedIsGuest: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (cancelled) return;
        const isValidGuest = !error && data.user?.user_metadata?.is_guest === true;
        if (!isValidGuest) {
          setResolvedIsGuest(false);
          setActiveTab((prev) => (prev === "signup" ? "signin" : prev));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedIsGuest(false);
          setActiveTab((prev) => (prev === "signup" ? "signin" : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveTab, setResolvedIsGuest, sessionUser]);
}

export function useVerifyTabSessionSync({
  activeTab,
  router,
}: {
  activeTab: AuthTab;
  router: AuthRouter;
}) {
  const hasHandledCrossTabSignIn = useRef(false);

  useEffect(() => {
    if (activeTab !== "verify") return;

    const completeCrossTabSignIn = () => {
      if (hasHandledCrossTabSignIn.current) return;
      hasHandledCrossTabSignIn.current = true;
      router.refresh();
      router.replace("/dashboard");
    };

    const supabase = createClient();
    const checkForExistingSession = async () => {
      if (hasHandledCrossTabSignIn.current) {
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session) {
        completeCrossTabSignIn();
      }
    };
    const handleWindowFocus = () => {
      void checkForExistingSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForExistingSession();
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        completeCrossTabSignIn();
      }
    });
    void checkForExistingSession();

    const sessionPollId = window.setInterval(() => {
      if (hasHandledCrossTabSignIn.current) {
        window.clearInterval(sessionPollId);
        return;
      }
      void checkForExistingSession();
    }, 1000);
    const unsubscribeCrossTabVerification = subscribeToEmailVerificationComplete(() => {
      void checkForExistingSession();
    });
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(sessionPollId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
      unsubscribeCrossTabVerification();
      hasHandledCrossTabSignIn.current = false;
    };
  }, [activeTab, router]);
}

export function useAuthCooldowns({
  activeTab,
  forgotCooldown,
  forgotError,
  forgotSentAt,
  forgotState,
  resendCooldown,
  resendState,
  setForgotBannerMode,
  setForgotCooldown,
  setResendBannerMode,
  setResendCooldown,
  verifyError,
  verifySentAt,
}: {
  activeTab: AuthTab;
  forgotCooldown: number;
  forgotError?: string;
  forgotSentAt?: number;
  forgotState: ForgotPasswordState;
  resendCooldown: number;
  resendState: ResendState;
  setForgotBannerMode: Dispatch<SetStateAction<AuthBannerMode>>;
  setForgotCooldown: Dispatch<SetStateAction<number>>;
  setResendBannerMode: Dispatch<SetStateAction<AuthBannerMode>>;
  setResendCooldown: Dispatch<SetStateAction<number>>;
  verifyError?: string;
  verifySentAt?: number;
}) {
  useEffect(() => {
    if (activeTab !== "verify" || verifyError || verifySentAt === undefined) {
      return;
    }

    const remaining = getRemainingResendCooldownSeconds(verifySentAt);
    if (remaining <= 0) {
      return;
    }

    setResendCooldown((current) => Math.max(current, remaining));
    setResendBannerMode((current) => current ?? "cooldown");
  }, [activeTab, setResendBannerMode, setResendCooldown, verifyError, verifySentAt]);

  useEffect(() => {
    if (activeTab !== "forgot" || forgotError || forgotSentAt === undefined) {
      return;
    }

    const remaining = getRemainingResendCooldownSeconds(forgotSentAt);
    if (remaining <= 0) {
      return;
    }

    setForgotCooldown((current) => Math.max(current, remaining));
    setForgotBannerMode((current) => current ?? "cooldown");
  }, [activeTab, forgotError, forgotSentAt, setForgotBannerMode, setForgotCooldown]);

  useEffect(() => {
    if (!resendState) {
      return;
    }

    if ("success" in resendState) {
      setResendCooldown(resendState.cooldownSeconds);
      setResendBannerMode("sent");
      return;
    }

    if ("rateLimited" in resendState) {
      setResendCooldown(resendState.cooldownSeconds);
      setResendBannerMode("cooldown");
    }
  }, [resendState, setResendBannerMode, setResendCooldown]);

  useEffect(() => {
    if (!forgotState) {
      return;
    }

    if ("success" in forgotState) {
      setForgotCooldown(forgotState.cooldownSeconds);
      setForgotBannerMode("sent");
      return;
    }

    if ("rateLimited" in forgotState) {
      setForgotCooldown(forgotState.cooldownSeconds);
      setForgotBannerMode("cooldown");
    }
  }, [forgotState, setForgotBannerMode, setForgotCooldown]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown, setResendCooldown]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const id = setInterval(() => setForgotCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [forgotCooldown, setForgotCooldown]);
}

export function useAuthSearchParamSync({
  hasSearchFlow,
  initialFlow,
  initialForgotEmail,
  searchEmail,
  searchFlow,
  searchTab,
  setActiveTab,
  setForgotEmail,
  setVerifyEmail,
  setVerifyFlow,
}: {
  hasSearchFlow: boolean;
  initialFlow?: VerificationFlow;
  initialForgotEmail?: string;
  searchEmail?: string;
  searchFlow?: VerificationFlow;
  searchTab?: AuthTab;
  setActiveTab: Dispatch<SetStateAction<AuthTab>>;
  setForgotEmail: Dispatch<SetStateAction<string>>;
  setVerifyEmail: Dispatch<SetStateAction<string>>;
  setVerifyFlow: Dispatch<SetStateAction<VerificationFlow | undefined>>;
}) {
  useEffect(() => {
    if (searchTab) {
      setActiveTab(searchTab);
    }
  }, [searchTab, setActiveTab]);

  useEffect(() => {
    if (searchEmail !== undefined) {
      setVerifyEmail(searchEmail);
    }
  }, [searchEmail, setVerifyEmail]);

  useEffect(() => {
    if (searchTab === "forgot") {
      setForgotEmail(searchEmail ?? initialForgotEmail ?? "");
    }
  }, [initialForgotEmail, searchEmail, searchTab, setForgotEmail]);

  useEffect(() => {
    if (hasSearchFlow) {
      setVerifyFlow(searchFlow);
      return;
    }

    if (searchTab === "verify" && initialFlow === undefined) {
      setVerifyFlow(undefined);
    }
  }, [hasSearchFlow, initialFlow, searchFlow, searchTab, setVerifyFlow]);
}
