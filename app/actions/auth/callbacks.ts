import { headers } from "next/headers";

export function normalizeOrigin(origin: string) {
  return origin.replace(/\/+$/, "");
}

export async function getRequestOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  }

  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) {
    return normalizeOrigin(origin);
  }

  const forwardedHost = headersList.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headersList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return normalizeOrigin((forwardedProto ?? "https") + "://" + forwardedHost);
  }

  const host = headersList.get("host")?.split(",")[0]?.trim();
  if (host) {
    const protocol =
      forwardedProto ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return normalizeOrigin(protocol + "://" + host);
  }

  return "http://localhost:3000";
}

export function getSignupVerificationCallbackUrl(origin: string) {
  return origin + "/auth/callback?signup_confirm=1";
}

export function getActivationVerificationCallbackUrl(origin: string) {
  return origin + "/auth/callback?activation=1";
}

export function getResetPasswordCallbackUrl(
  origin: string,
  options?: {
    email?: string;
    sentAt?: number;
  }
) {
  const params = new URLSearchParams({
    next: "/reset-password",
  });

  if (options?.email) {
    params.set("email", options.email);
  }

  if (options?.sentAt !== undefined) {
    params.set("sent_at", String(options.sentAt));
  }

  return origin + "/auth/callback?" + params.toString();
}
