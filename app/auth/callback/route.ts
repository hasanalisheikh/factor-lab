import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")
  // `next` lets the caller specify a post-auth redirect (defaults to /dashboard)
  const next = searchParams.get("next") ?? "/dashboard"

  const isResetFlow = next.startsWith("/reset-password")

  function errorRedirect(message?: string) {
    const loginUrl = new URL("/login", origin)
    loginUrl.searchParams.set("tab", isResetFlow ? "forgot" : "verify")
    loginUrl.searchParams.set(
      "error",
      message ?? (isResetFlow
        ? "Reset link expired. Please request a new one."
        : "Verification link expired. Please request a new one.")
    )
    return NextResponse.redirect(loginUrl)
  }

  // Surface Supabase auth errors (e.g. expired link)
  if (error) {
    return errorRedirect(errorDescription ?? undefined)
  }

  if (!code) {
    return errorRedirect()
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return errorRedirect()
  }

  // Successful verification — redirect to the app
  return NextResponse.redirect(new URL(next, origin))
}
