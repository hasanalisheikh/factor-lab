import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAccountCreationRateLimit } from "@/lib/supabase/rate-limit";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ── Rate limit by IP ──────────────────────────────────────────────────────
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, error: rateLimitError } = await checkAccountCreationRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: rateLimitError ?? "Rate limit exceeded. Try again later." },
      { status: 429 }
    );
  }

  // ── Create guest user via admin client ───────────────────────────────────
  const admin = createAdminClient();
  const guestId = crypto.randomUUID();
  const email = `guest_${guestId}@factorlab.local`;
  // 36-char random password — guests never see or use it (3× UUIDs exceeds bcrypt's 72-byte max)
  const password = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const { data: userData, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    user_metadata: {
      is_guest: true,
      guest_created_at: now,
      guest_expires_at: expiresAt,
    },
    email_confirm: true, // skip email verification for guests
  });

  if (createError || !userData.user) {
    console.error("[guest] createUser error:", createError?.message);
    return NextResponse.json(
      { error: "Failed to create guest account. Please try again." },
      { status: 500 }
    );
  }

  // ── Sign in as the guest user, setting session cookies on the response ────
  // We build the response first, then configure a server client that writes
  // cookies directly onto it — the standard @supabase/ssr pattern for route handlers.
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    console.error("[guest] signIn error:", signInError.message);
    return NextResponse.json(
      { error: "Guest account created but sign-in failed. Please refresh." },
      { status: 500 }
    );
  }

  return response;
}
