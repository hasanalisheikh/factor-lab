import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Email Verified | FactorLab",
};

/**
 * Shown after a successful email verification OTP exchange.
 * This page is intentionally auth-free — it must work even when
 * the user clicks the verification link in a different browser session.
 */
export default function VerifiedPage() {
  return (
    <main className="bg-background relative isolate flex min-h-dvh items-center justify-center px-4">
      {/* subtle green glow matching login page aesthetic */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(40,199,130,0.12),transparent_45%)]" />

      <Card className="border-border bg-card relative z-10 w-full max-w-sm p-8 text-center shadow-xl">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
        <h1 className="text-foreground mb-2 text-lg font-semibold">Email Verified</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Your account has been verified. You can close this page and sign in to FactorLab now.
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Sign in to FactorLab</Link>
        </Button>
      </Card>
    </main>
  );
}
