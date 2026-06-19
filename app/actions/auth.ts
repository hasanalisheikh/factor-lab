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

export async function signInAction(prev: unknown, formData: FormData) {
  return signInActionImpl(null, formData);
}

export async function signOutAction() {
  return signOutActionImpl();
}

export async function signUpAction(prev: unknown, formData: FormData) {
  return signUpActionImpl(null, formData);
}

export async function upgradeGuestAction(prev: unknown, formData: FormData) {
  return upgradeGuestActionImpl(null, formData);
}

export async function upgradeGuestToEmailPassword(input: { email: string; password: string }) {
  return upgradeGuestToEmailPasswordImpl(input);
}

export async function forgotPasswordAction(prev: unknown, formData: FormData) {
  return forgotPasswordActionImpl(null, formData);
}

export async function resendVerificationAction(prev: unknown, formData: FormData) {
  return resendVerificationActionImpl(null, formData);
}

export async function resetPasswordAction(prev: unknown, formData: FormData) {
  return resetPasswordActionImpl(null, formData);
}
