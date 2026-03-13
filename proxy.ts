import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  // If Supabase is not configured (e.g. env vars missing in preview deployments),
  // pass through rather than failing during proxy execution.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request })
  }

  // Start with a passthrough response — will be replaced if cookies need refreshing
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Propagate cookie mutations to both the cloned request and the response
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: use getUser() not getSession() to avoid trusting unverified JWT claims
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Allow unauthenticated access to /login, /api/auth/*, and /auth/callback
  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/")
  const isAuthApi = pathname.startsWith("/api/auth/")
  const isAuthCallback = pathname.startsWith("/auth/")
  const isResetPasswordPage =
    pathname === "/reset-password" || pathname.startsWith("/reset-password/")

  if (!user && !isLoginPage && !isAuthApi && !isAuthCallback && !isResetPasswordPage) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/login"
    return NextResponse.redirect(loginUrl)
  }

  // Redirect already-authenticated users away from /login,
  // but allow guest users through so they can sign in and transfer their data.
  if (user && isLoginPage && !user.user_metadata?.is_guest) {
    const dashboardUrl = request.nextUrl.clone()
    dashboardUrl.pathname = "/dashboard"
    return NextResponse.redirect(dashboardUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
