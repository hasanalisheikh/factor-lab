"use server";

import {
  forgotPasswordAction as forgotPasswordActionImpl,
  resendVerificationAction as resendVerificationActionImpl,
  resetPasswordAction as resetPasswordActionImpl,
} from "./auth/password-actions";
import {
  signInAction as signInActionImpl,
  signOutAction as signOutActionImpl,
  signUpAction as signUpActionImpl,
  upgradeGuestAction as upgradeGuestActionImpl,
  upgradeGuestToEmailPassword as upgradeGuestToEmailPasswordImpl,
} from "./auth/session-actions";
import type { AuthState, ForgotPasswordState, ResendState, ResetPasswordState } from "./auth/state";

export type { AuthState, ForgotPasswordState, ResendState, ResetPasswordState };

export async function signInAction(prev: unknown, formData: FormData) {
  return signInActionImpl(prev as AuthState, formData);
}

export async function signOutAction() {
  return signOutActionImpl();
}

export async function signUpAction(prev: unknown, formData: FormData) {
  return signUpActionImpl(prev as AuthState, formData);
}

export async function upgradeGuestAction(prev: unknown, formData: FormData) {
  return upgradeGuestActionImpl(prev as AuthState, formData);
}

export async function upgradeGuestToEmailPassword(input: { email: string; password: string }) {
  return upgradeGuestToEmailPasswordImpl(input);
}

export async function forgotPasswordAction(prev: unknown, formData: FormData) {
  return forgotPasswordActionImpl(prev as ForgotPasswordState, formData);
}

export async function resendVerificationAction(prev: unknown, formData: FormData) {
  return resendVerificationActionImpl(prev as ResendState, formData);
}

export async function resetPasswordAction(prev: unknown, formData: FormData) {
  return resetPasswordActionImpl(prev as ResetPasswordState, formData);
}
