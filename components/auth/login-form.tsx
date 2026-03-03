"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { signInAction, signUpAction, type AuthState } from "@/app/actions/auth"
import { Logo } from "@/components/logo"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function LoginForm() {
  const [signInState, signInAction_, isSignInPending] = useActionState<AuthState, FormData>(
    signInAction,
    null
  )
  const [signUpState, signUpAction_, isSignUpPending] = useActionState<AuthState, FormData>(
    signUpAction,
    null
  )

  const [isGuestPending, setIsGuestPending] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin")

  const [signInEmail, setSignInEmail] = useState("")
  const [signInPassword, setSignInPassword] = useState("")
  const [signUpEmail, setSignUpEmail] = useState("")
  const [signUpPassword, setSignUpPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordMismatchError, setPasswordMismatchError] = useState<string | null>(null)

  const isAnyPending = isSignInPending || isSignUpPending || isGuestPending

  const formatFriendlyError = (error: string) => {
    const message = error.toLowerCase()
    if (message.includes("rate limit") || message.includes("too many") || message.includes("429")) {
      return "Too many attempts right now. Please wait a bit and try again."
    }
    return error
  }

  async function handleGuest() {
    if (isAnyPending) return
    setIsGuestPending(true)
    setGuestError(null)
    setPasswordMismatchError(null)
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const rawError =
          (data as { error?: string }).error ?? "Failed to create guest account. Try again."
        setGuestError(formatFriendlyError(rawError))
        return
      }
      window.location.href = "/dashboard"
    } catch {
      setGuestError("Network error. Please check your connection and try again.")
    } finally {
      setIsGuestPending(false)
    }
  }

  function switchTab(tab: "signin" | "signup") {
    setActiveTab(tab)
    setGuestError(null)
    setPasswordMismatchError(null)
  }

  const signInError = signInState?.error ? formatFriendlyError(signInState.error) : null
  const signUpError = signUpState?.error ? formatFriendlyError(signUpState.error) : null

  const inputClassName =
    "h-9 border-white/10 bg-white/5 text-white/90 placeholder:text-white/45 focus-visible:border-primary/70 focus-visible:ring-primary/40"
  const primaryButtonClassName =
    "h-9 w-full bg-primary text-primary-foreground shadow-[0_14px_28px_-14px_rgba(40,199,130,0.7)] hover:bg-primary/90"

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5">
        <div className="space-y-1.5">
          <Logo className="[&_span]:!text-[24px]" size={26} />
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight text-white/90">
              {activeTab === "signin" ? "Sign in" : "Create account"}
            </h1>
            <p className="text-sm text-white/60">
              Quant research dashboard for backtests and reports.
            </p>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => switchTab(value as "signin" | "signup")}
          className="w-full gap-2"
        >
          <TabsList className="grid h-9 w-full grid-cols-2 border border-white/10 bg-white/5 p-1">
            <TabsTrigger
              value="signin"
              className="text-sm text-white/60 data-[state=active]:border-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
            >
              Sign In
            </TabsTrigger>
            <TabsTrigger
              value="signup"
              className="text-sm text-white/60 data-[state=active]:border-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
            >
              Create Account
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-0 min-h-[240px] sm:min-h-[252px]">
            <form
              action={signInAction_}
              onSubmit={() => {
                setGuestError(null)
                setPasswordMismatchError(null)
              }}
              className="space-y-2.5"
            >
              <div className="space-y-1.5">
                <Label htmlFor="signin-email" className="text-xs font-medium text-white/60">
                  Email
                </Label>
                <Input
                  id="signin-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={signInEmail}
                  onChange={(event) => setSignInEmail(event.target.value)}
                  disabled={isAnyPending}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin-password" className="text-xs font-medium text-white/60">
                  Password
                </Label>
                <Input
                  id="signin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={signInPassword}
                  onChange={(event) => setSignInPassword(event.target.value)}
                  disabled={isAnyPending}
                  className={inputClassName}
                />
              </div>

              {signInError && (
                <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{signInError}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={isAnyPending}
                aria-disabled={isAnyPending}
                className={primaryButtonClassName}
              >
                {isSignInPending ? (
                  <>
                    <Spinner className="size-4" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>

              <p className="text-center text-xs text-white/45">
                Don&apos;t have an account?{" "}
                <Link
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    switchTab("signup")
                  }}
                  className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                >
                  Create one
                </Link>
              </p>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="mt-0 min-h-[240px] sm:min-h-[252px]">
            <form
              action={signUpAction_}
              onSubmit={(event) => {
                setGuestError(null)
                if (signUpPassword !== confirmPassword) {
                  event.preventDefault()
                  setPasswordMismatchError("Password mismatch. Please make sure both passwords match.")
                  return
                }
                setPasswordMismatchError(null)
              }}
              className="space-y-2.5"
            >
              <div className="space-y-1.5">
                <Label htmlFor="signup-email" className="text-xs font-medium text-white/60">
                  Email
                </Label>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={signUpEmail}
                  onChange={(event) => setSignUpEmail(event.target.value)}
                  disabled={isAnyPending}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-password" className="text-xs font-medium text-white/60">
                  Password
                </Label>
                <Input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={signUpPassword}
                  onChange={(event) => setSignUpPassword(event.target.value)}
                  disabled={isAnyPending}
                  className={inputClassName}
                />
                <p className="text-[11px] text-white/40">
                  8+ characters, one uppercase letter, one special character
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="signup-confirm-password"
                  className="text-xs font-medium text-white/60"
                >
                  Confirm Password
                </Label>
                <Input
                  id="signup-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={isAnyPending}
                  className={inputClassName}
                />
              </div>

              {(passwordMismatchError || signUpError) && (
                <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{passwordMismatchError ?? signUpError}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={isAnyPending}
                aria-disabled={isAnyPending}
                className={primaryButtonClassName}
              >
                {isSignUpPending ? (
                  <>
                    <Spinner className="size-4" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>

              <p className="text-center text-xs text-white/45">
                Already have an account?{" "}
                <Link
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    switchTab("signin")
                  }}
                  className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </form>
          </TabsContent>
        </Tabs>

        {guestError && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
            <AlertCircle className="size-4" />
            <AlertDescription>{guestError}</AlertDescription>
          </Alert>
        )}

        <Button
          variant="outline"
          onClick={handleGuest}
          disabled={isAnyPending}
          aria-disabled={isAnyPending}
          className="h-9 w-full border-white/15 bg-transparent text-white/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        >
          {isGuestPending ? (
            <>
              <Spinner className="size-4" />
              Setting up guest session...
            </>
          ) : (
            "Continue as Guest"
          )}
        </Button>
      </div>

      <p className="mt-auto text-xs text-white/45">
        FactorLab • Quant Research Dashboard
        <br />
        Not financial advice.
      </p>
    </div>
  )
}
