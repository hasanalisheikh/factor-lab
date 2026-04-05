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

export function buildVerifyUrl({
  email,
  flow,
  sentAt,
}: {
  email: string;
  flow: VerificationFlow;
  sentAt?: number;
}) {
  const params = new URLSearchParams({
    tab: "verify",
    email,
    flow,
  });

  if (sentAt !== undefined) {
    params.set("sent_at", String(sentAt));
  }

  return `/login?${params.toString()}`;
}
