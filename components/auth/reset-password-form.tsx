"use client"

import { useActionState, useState } from "react"
import { AlertCircle } from "lucide-react"
import { resetPasswordAction, type ResetPasswordState } from "@/app/actions/auth"
import { Logo } from "@/components/logo"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

export function ResetPasswordForm() {
  const [state, action_, isPending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    null
  )

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [mismatchError, setMismatchError] = useState<string | null>(null)

  const inputClassName =
    "h-9 border-white/10 bg-white/5 text-white/90 placeholder:text-white/45 focus-visible:border-primary/70 focus-visible:ring-primary/40"
  const primaryButtonClassName =
    "h-9 w-full bg-primary text-primary-foreground shadow-[0_14px_28px_-14px_rgba(40,199,130,0.7)] hover:bg-primary/90"

  return (
    <Card className="border-white/10 bg-card/95 p-6 shadow-[0_28px_75px_-36px_rgba(0,0,0,0.95)]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Logo className="[&_span]:!text-[24px]" size={26} />
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight text-white/90">
              Set new password
            </h1>
            <p className="text-sm text-white/60">
              Choose a strong password for your account.
            </p>
          </div>
        </div>

        <form
          action={action_}
          onSubmit={(event) => {
            if (password !== confirmPassword) {
              event.preventDefault()
              setMismatchError("Passwords do not match.")
              return
            }
            setMismatchError(null)
          }}
          className="space-y-2.5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="reset-password" className="text-xs font-medium text-white/60">
              New password
            </Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              className={inputClassName}
            />
            <p className="text-[11px] text-white/40">
              8+ characters, one uppercase letter, one special character
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm-password" className="text-xs font-medium text-white/60">
              Confirm new password
            </Label>
            <Input
              id="reset-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isPending}
              className={inputClassName}
            />
          </div>

          {(mismatchError ?? state?.error) && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertCircle className="size-4" />
              <AlertDescription>{mismatchError ?? state?.error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={isPending}
            aria-disabled={isPending}
            className={primaryButtonClassName}
          >
            {isPending ? (
              <>
                <Spinner className="size-4" />
                Updating password...
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>

        <p className="mt-4 text-xs text-white/45">
          FactorLab • Quant Research Dashboard
          <br />
          Not financial advice.
        </p>
      </div>
    </Card>
  )
}
