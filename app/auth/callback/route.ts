import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash") ?? searchParams.get("token");
  const verificationType = searchParams.get("type");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  // `next` lets the caller specify a post-auth redirect (defaults to /dashboard)
  const next = searchParams.get("next") ?? "/dashboard";
  // `activation=1` is set by the guest-upgrade OTP email so we route to the
  // "verified" page instead of the dashboard
  const isActivation = searchParams.get("activation") === "1";
  // `signup_confirm=1` is set by signUpAction / resendVerificationAction so that
  // PKCE code-exchange confirmations also land on /auth/verified instead of /dashboard
  const isSignupConfirm = searchParams.get("signup_confirm") === "1";
  const isResetFlow = next.startsWith("/reset-password");
  const verifiedPagePath = "/auth/verified?verified=1";
  const verificationCompletePath =
    !isResetFlow && (isActivation || isSignupConfirm) ? verifiedPagePath : null;
  const shouldRouteToVerifiedPage =
    !isResetFlow &&
    ((tokenHash != null && verificationType != null) || isActivation || isSignupConfirm);

  function errorRedirect(message?: string) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("tab", isResetFlow ? "forgot" : "verify");
    loginUrl.searchParams.set(
      "error",
      message ??
        (isResetFlow
          ? "Reset link expired. Please request a new one."
          : "Verification link expired. Please request a new one.")
    );
    return NextResponse.redirect(loginUrl);
  }

  function hashForwardResponse() {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("tab", isResetFlow ? "forgot" : "verify");
    loginUrl.searchParams.set(
      "error",
      isResetFlow
        ? "Reset link expired. Please request a new one."
        : "Verification link expired. Please request a new one."
    );

    const successUrl = new URL(
      verificationCompletePath ?? (isResetFlow ? "/reset-password" : "/login"),
      origin
    );
    const destination = successUrl.toString();
    const fallback = loginUrl.toString();
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Completing sign-in…</title>
  </head>
  <body>
    <script>
      const hash = window.location.hash || "";
      const hasAuthTokens = /(access_token|refresh_token|type=)/.test(hash);
      window.location.replace(hasAuthTokens ? ${JSON.stringify(destination)} + hash : ${JSON.stringify(fallback)});
    </script>
  </body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Surface Supabase auth errors (e.g. expired link)
  if (error) {
    return errorRedirect(errorDescription ?? undefined);
  }

  if (!code && !(tokenHash && verificationType)) {
    return hashForwardResponse();
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  if (tokenHash && verificationType) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verificationType as EmailOtpType,
    });
    if (verifyError) {
      return errorRedirect(verifyError.message);
    }
  } else if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return errorRedirect();
    }
  }

  // Successful verification:
  // - Email OTP (signup/email_change) → verified page
  // - Activation magic link (isActivation) → verified page
  // - Everything else (password reset, normal magic link) → follow `next`
  const successDest = shouldRouteToVerifiedPage ? verifiedPagePath : next;
  return NextResponse.redirect(new URL(successDest, origin));
}
