import { useEffect, useRef } from "react";

import { subscribeToEmailVerificationComplete } from "@/lib/auth/email-verification-sync";
import { subscribeToPasswordResetComplete } from "@/lib/auth/password-reset-sync";
import { getRemainingResendCooldownSeconds } from "@/lib/auth/resend-verification";
import { createClient } from "@/lib/supabase/client";

import type { ForgotPasswordState, ResendState } from "@/app/actions/auth";
import type { Dispatch, SetStateAction } from "react";
import { getSentAtForCooldown } from "./types";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthBannerMode, AuthTab, LoginFormProps } from "./types";

type AuthRouter = {
  refresh: () => void;
  replace: (href: string) => void;
};

type UrlRouter = {
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

export function usePasswordResetCompleteSync({
  activeTab,
  forgotEmail,
  pathname,
  router,
  searchParams,
  setActiveTab,
  setGuestError,
  setPasswordMismatchError,
  setPasswordResetComplete,
  setSignInEmail,
  setSignInPassword,
  setVerifyFlow,
  signInEmail,
}: {
  activeTab: AuthTab;
  forgotEmail: string;
  pathname: string;
  router: UrlRouter;
  searchParams: URLSearchParams;
  setActiveTab: Dispatch<SetStateAction<AuthTab>>;
  setGuestError: Dispatch<SetStateAction<string | null>>;
  setPasswordMismatchError: Dispatch<SetStateAction<string | null>>;
  setPasswordResetComplete: Dispatch<SetStateAction<boolean>>;
  setSignInEmail: Dispatch<SetStateAction<string>>;
  setSignInPassword: Dispatch<SetStateAction<string>>;
  setVerifyFlow: Dispatch<SetStateAction<VerificationFlow | undefined>>;
  signInEmail: string;
}) {
  useEffect(() => {
    if (activeTab !== "signin" && activeTab !== "forgot") {
      return;
    }

    return subscribeToPasswordResetComplete(() => {
      const nextEmail = forgotEmail.trim() || signInEmail.trim();

      setActiveTab("signin");
      setGuestError(null);
      setPasswordMismatchError(null);
      setPasswordResetComplete(true);
      setVerifyFlow(undefined);
      setSignInPassword("");
      if (nextEmail) {
        setSignInEmail(nextEmail);
      }

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("tab");
      nextParams.delete("email");
      nextParams.delete("flow");
      nextParams.delete("sent_at");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }, [
    activeTab,
    forgotEmail,
    pathname,
    router,
    searchParams,
    setActiveTab,
    setGuestError,
    setPasswordMismatchError,
    setPasswordResetComplete,
    setSignInEmail,
    setSignInPassword,
    setVerifyFlow,
    signInEmail,
  ]);
}
