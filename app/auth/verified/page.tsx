import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SessionBroadcast } from "@/components/auth/session-broadcast";

export const metadata: Metadata = {
  title: "Email Confirmed | FactorLab",
};

/**
 * Shown after a successful activation-link click.
 *
 * Only reachable with ?verified=1 — set exclusively by /auth/callback when it
 * detects an activation flow. Direct navigation without the param redirects
 * to /dashboard.
 *
 * SessionBroadcast syncs the session (established server-side by the callback)
 * to localStorage so the original /login?tab=verify tab detects the SIGNED_IN
 * event and navigates to /dashboard automatically.
 */
export default async function VerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const params = await searchParams;
  if (!params.verified) {
    redirect("/dashboard");
  }

  return (
    <main className="bg-background relative isolate flex min-h-dvh items-center justify-center px-4">
      {/* subtle green glow matching login page aesthetic */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(40,199,130,0.12),transparent_45%)]" />

      <SessionBroadcast />

      <Card className="border-border bg-card relative z-10 w-full max-w-sm p-8 text-center shadow-xl">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
        <h1 className="text-foreground mb-2 text-lg font-semibold">Email Confirmed</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          You&apos;re signed in now. You can close this tab. If your original login window is still
          open, it will refresh and continue automatically.
        </p>
        <p className="text-muted-foreground/60 text-xs">
          If you need it,{" "}
          <Link href="/dashboard" className="text-primary underline-offset-2 hover:underline">
            go to your dashboard
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}
