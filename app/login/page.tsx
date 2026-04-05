import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { LoginVisual } from "@/components/auth/login-visual";
import { Card } from "@/components/ui/card";
import { normalizeVerificationFlow } from "@/lib/auth/verification-flow";
import { createClient } from "@/lib/supabase/server";

function parseSentAt(value?: string) {
  if (!value) {
    return undefined;
  }

  const sentAt = Number(value);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    tab?: string;
    email?: string;
    flow?: string;
    upgrade?: string;
    sent_at?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error, tab, email, flow, upgrade, sent_at: sentAt } = await searchParams;

  const isVerify = tab === "verify";
  const isForgot = tab === "forgot";
  const isGuestSession = user?.user_metadata?.is_guest === true;

  // Guests are already authenticated — send them to the dashboard unless they
  // arrived via the intentional "Create account" upgrade path (?upgrade=1).
  if (isGuestSession && upgrade !== "1") {
    redirect("/dashboard");
  }

  const initialTab = isVerify
    ? "verify"
    : isForgot
      ? "forgot"
      : upgrade === "1" && isGuestSession
        ? "signup"
        : undefined;

  return (
    <div className="w-full">
      <Card className="bg-card/95 relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border-white/10 shadow-[0_28px_75px_-36px_rgba(0,0,0,0.95)] lg:min-h-[520px]">
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(120deg,rgba(8,11,17,0)_38%,rgba(8,11,17,0.86)_55%,rgba(10,15,22,1)_100%),radial-gradient(circle_at_86%_14%,rgba(40,199,130,0.2),transparent_40%),radial-gradient(circle_at_78%_86%,rgba(40,199,130,0.1),transparent_44%)]" />
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-5">
          <section className="bg-card/96 relative order-2 border-t border-white/10 p-4 sm:p-5 lg:order-1 lg:col-span-2 lg:border-t-0 lg:border-r lg:p-4">
            <LoginForm
              authError={isVerify || isForgot ? undefined : error}
              initialTab={initialTab}
              initialEmail={email}
              initialFlow={isVerify ? normalizeVerificationFlow(flow) : undefined}
              initialSentAt={isVerify ? parseSentAt(sentAt) : undefined}
              verifyError={isVerify ? error : undefined}
              forgotError={isForgot ? error : undefined}
              sessionUser={
                user
                  ? {
                      email: user.email ?? null,
                      isGuest: isGuestSession,
                    }
                  : null
              }
            />
          </section>
          <section className="order-1 min-h-[180px] overflow-hidden lg:order-2 lg:col-span-3 lg:min-h-0">
            <LoginVisual />
          </section>
        </div>
      </Card>
    </div>
  );
}
