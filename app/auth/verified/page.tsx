import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SessionBroadcast } from "@/components/auth/session-broadcast";

export const metadata: Metadata = {
  title: "Email Confirmed | FactorLab",
};

/**
 * Shown after a successful signup-confirmation or activation-link click.
 *
 * Only reachable with ?verified=1 — set exclusively by /auth/callback when it
 * detects a verification-complete flow. Direct navigation without the param
 * redirects to /dashboard.
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

      <Card className="border-border bg-card relative z-10 w-full max-w-sm p-8 text-center shadow-xl">
        <SessionBroadcast />
      </Card>
    </main>
  );
}
