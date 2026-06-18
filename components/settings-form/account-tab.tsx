"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Copy, CopyCheck, Loader2 } from "lucide-react";

import {
  changePasswordAction,
  deleteAccountAction,
  type AccountActionState,
  upgradeGuestAction,
} from "@/app/actions/account";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ErrorAlert, SuccessAlert } from "./alerts";
import type { UserInfo } from "./types";

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CopyCheck className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ─── Change password form ─────────────────────────────────────────────────────

function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    changePasswordAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current_password" className="text-muted-foreground text-[12px] font-medium">
          Current password
        </Label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new_password" className="text-muted-foreground text-[12px] font-medium">
          New password
        </Label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          placeholder="Min 8 chars, 1 uppercase, 1 special"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm_password" className="text-muted-foreground text-[12px] font-medium">
          Confirm password
        </Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat new password"
          className="bg-secondary/40 border-border h-8 text-[13px]"
          required
        />
      </div>

      {state?.error && <ErrorAlert message={state.error} />}
      {state?.success && <SuccessAlert message="Password updated successfully." />}

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="h-8 w-full text-[12px] font-medium"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Updating…
          </>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  );
}

// ─── Guest upgrade form ───────────────────────────────────────────────────────

function GuestUpgradeForm() {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    upgradeGuestAction,
    null
  );

  return (
    <Card className="bg-card border-emerald-900/40">
      <CardHeader className="px-5 pt-5 pb-3">
        <CardTitle className="text-[13px] font-medium text-emerald-400">
          Upgrade guest account
        </CardTitle>
        <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
          Add an email and password to keep your runs permanently. Your existing data is preserved.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_email"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Email
            </Label>
            <Input
              id="upgrade_email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_password"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Password
            </Label>
            <Input
              id="upgrade_password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Min 8 chars, 1 uppercase, 1 special"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="upgrade_confirm"
              className="text-muted-foreground text-[12px] font-medium"
            >
              Confirm password
            </Label>
            <Input
              id="upgrade_confirm"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              className="bg-secondary/40 border-border h-8 text-[13px]"
              required
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="h-8 w-full bg-emerald-700 text-[12px] font-medium text-white hover:bg-emerald-600"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Upgrading…
              </>
            ) : (
              "Upgrade account"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

function DangerZone({ isGuest }: { isGuest: boolean }) {
  const [state, formAction, isPending] = useActionState<AccountActionState, FormData>(
    deleteAccountAction,
    null
  );
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = confirmText === "DELETE" && (isGuest || password.length > 0);

  return (
    <Card className="bg-card border-destructive/30">
      <CardHeader className="px-5 pt-5 pb-3">
        <CardTitle className="text-destructive flex items-center gap-1.5 text-[13px] font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          Danger Zone
        </CardTitle>
        <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
          Permanently deletes all your runs, reports, and account data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="flex flex-col gap-3">
          {!isGuest && (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="delete_password"
                className="text-muted-foreground text-[12px] font-medium"
              >
                Current password
              </Label>
              <Input
                id="delete_password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30 h-8 text-[13px]"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm_text" className="text-muted-foreground text-[12px] font-medium">
              Type <span className="text-destructive font-mono font-semibold">DELETE</span> to
              confirm
            </Label>
            <Input
              id="confirm_text"
              name="confirm_text"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="bg-secondary/40 border-destructive/30 focus-visible:ring-destructive/30 h-8 text-[13px]"
              autoComplete="off"
            />
          </div>

          {state?.error && <ErrorAlert message={state.error} />}

          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={isPending || !canSubmit}
            className="h-8 w-full text-[12px] font-medium"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete account permanently"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Account tab ──────────────────────────────────────────────────────────────

export function AccountTab({ user }: { user: UserInfo }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-3">
          <CardTitle className="text-card-foreground text-[13px] font-medium">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5 pb-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Email
            </span>
            <span className="text-foreground text-[13px]">{user.email}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Account type
            </span>
            {user.is_guest ? (
              <Badge
                variant="outline"
                className="w-fit border-amber-700/50 bg-amber-950/20 text-[11px] text-amber-400"
              >
                Guest
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="w-fit border-emerald-700/50 bg-emerald-950/20 text-[11px] text-emerald-400"
              >
                User
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              User ID
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground truncate font-mono text-[12px]">
                {user.id}
              </span>
              <CopyButton text={user.id} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password change — only for authenticated (non-guest) users */}
      {!user.is_guest && (
        <Card className="bg-card border-border">
          <CardHeader className="px-5 pt-5 pb-3">
            <CardTitle className="text-card-foreground text-[13px] font-medium">Security</CardTitle>
            <CardDescription className="text-muted-foreground mt-0.5 text-[12px]">
              Change your account password.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ChangePasswordForm />
          </CardContent>
        </Card>
      )}

      {/* Guest upgrade */}
      {user.is_guest && <GuestUpgradeForm />}

      {/* Danger zone */}
      <DangerZone isGuest={user.is_guest} />
    </div>
  );
}
