import { useEffect } from "react";

import { subscribeToPasswordResetComplete } from "@/lib/auth/password-reset-sync";

import type { Dispatch, SetStateAction } from "react";
import type { VerificationFlow } from "@/lib/auth/verification-flow";
import type { AuthTab } from "../types";

type UrlRouter = {
  replace: (href: string) => void;
};

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
