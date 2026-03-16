"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { upgradeGuestToEmailPassword } from "@/app/actions/auth"

export type AccountActionState = { error?: string; success?: boolean } | null

// ─── Password validation ──────────────────────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Must contain at least one uppercase letter")
  .regex(/[^a-zA-Z0-9]/, "Must contain at least one special character")

// ─── Change Password ──────────────────────────────────────────────────────────

export async function changePasswordAction(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const currentPassword = String(formData.get("current_password") ?? "")
  const newPassword = String(formData.get("new_password") ?? "")
  const confirmPassword = String(formData.get("confirm_password") ?? "")

  if (!currentPassword) {
    return { error: "Current password is required" }
  }

  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  const parsed = passwordSchema.safeParse(newPassword)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()

  // Verify current password before allowing the change
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return { error: "Not authenticated" }
  }
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (signInError) {
    return { error: "Current password is incorrect" }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

// ─── Upgrade Guest Account ────────────────────────────────────────────────────
// Delegates to the shared auth upgrade flow so every guest upgrade path keeps
// the same UID and active session.

export async function upgradeGuestAction(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const password = String(formData.get("password") ?? "")
  const confirmPassword = String(formData.get("confirm_password") ?? "")
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  const state = await upgradeGuestToEmailPassword({
    email: String(formData.get("email") ?? "").trim(),
    password,
  })

  if (state && "error" in state) {
    return { error: state.error }
  }

  return null
}

// ─── Delete Account ───────────────────────────────────────────────────────────
// Deletes all user data then removes the auth user via admin client.

export async function deleteAccountAction(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const confirmation = String(formData.get("confirm_text") ?? "")
  if (confirmation !== "DELETE") {
    return { error: "Type DELETE to confirm" }
  }

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: "Not authenticated" }
  }

  // Non-guest accounts must confirm with their current password
  if (!user.user_metadata?.is_guest) {
    const password = String(formData.get("password") ?? "")
    if (!password) {
      return { error: "Password is required to delete your account" }
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password,
    })
    if (signInError) {
      return { error: "Incorrect password. Please try again." }
    }
  }

  const admin = createAdminClient()

  // Delete user-owned data in dependency order.
  // Child tables cascade from runs, but we delete explicitly to be safe.
  // All queries use the admin client (bypasses RLS).
  const { data: userRuns } = await admin
    .from("runs")
    .select("id")
    .eq("user_id", user.id)

  const runIds = (userRuns ?? []).map((r: { id: string }) => r.id)

  if (runIds.length > 0) {
    const childDeletes = await Promise.all([
      admin.from("model_predictions").delete().in("run_id", runIds),
      admin.from("model_metadata").delete().in("run_id", runIds),
      admin.from("positions").delete().in("run_id", runIds),
      admin.from("equity_curve").delete().in("run_id", runIds),
      admin.from("run_metrics").delete().in("run_id", runIds),
      admin.from("reports").delete().in("run_id", runIds),
      admin.from("jobs").delete().in("run_id", runIds),
    ])
    const childError = childDeletes.find((r) => r.error)?.error
    if (childError) {
      return { error: `Failed to delete account data: ${childError.message}` }
    }
    const { error: runsError } = await admin.from("runs").delete().in("id", runIds)
    if (runsError) {
      return { error: `Failed to delete account data: ${runsError.message}` }
    }
  }

  await admin.from("user_settings").delete().eq("user_id", user.id)

  // Delete the auth user — also cascades user_settings via FK ON DELETE CASCADE
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    return { error: `Failed to delete account: ${deleteError.message}` }
  }

  // Session is now invalid; redirect to login
  redirect("/login")
}
