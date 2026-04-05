export const VERIFICATION_FLOWS = ["signup", "upgrade"] as const;

export type VerificationFlow = (typeof VERIFICATION_FLOWS)[number];

export function normalizeVerificationFlow(
  flow: string | null | undefined
): VerificationFlow | undefined {
  if (flow === "signup" || flow === "upgrade") {
    return flow;
  }

  return undefined;
}

export function buildVerifyUrl({ email, flow }: { email: string; flow: VerificationFlow }) {
  const params = new URLSearchParams({
    tab: "verify",
    email,
    flow,
  });

  return `/login?${params.toString()}`;
}
