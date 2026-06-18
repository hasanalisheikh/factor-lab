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

export async function signInAction(prev: AuthState, formData: FormData): Promise<AuthState> {
  return signInActionImpl(prev, formData);
}

export async function signOutAction(): Promise<void> {
  return signOutActionImpl();
}

export async function signUpAction(prev: AuthState, formData: FormData): Promise<AuthState> {
  return signUpActionImpl(prev, formData);
}

export async function upgradeGuestAction(prev: AuthState, formData: FormData): Promise<AuthState> {
  return upgradeGuestActionImpl(prev, formData);
}

export async function upgradeGuestToEmailPassword(input: {
  email: string;
  password: string;
}): Promise<AuthState> {
  return upgradeGuestToEmailPasswordImpl(input);
}

export async function forgotPasswordAction(
  prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  return forgotPasswordActionImpl(prev, formData);
}

export async function resendVerificationAction(
  prev: ResendState,
  formData: FormData
): Promise<ResendState> {
  return resendVerificationActionImpl(prev, formData);
}

export async function resetPasswordAction(
  prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  return resetPasswordActionImpl(prev, formData);
}
