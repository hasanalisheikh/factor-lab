import "server-only";

import {
  buildResendCooldownMessage,
  RESEND_VERIFICATION_COOLDOWN_SECONDS,
} from "@/lib/auth/resend-verification";

export type RateLimitResult = {
  allowed: boolean;
  error?: string;
  retryAfterSeconds?: number;
};

/**
 * Check the per-email resend rate limit using Upstash Redis.
 * Allows 1 resend per 60 seconds per email address.
 */
export async function checkResendRateLimit(email: string): Promise<RateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn("[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — skipping rate limit");
    return { allowed: true };
  }

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");

    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(1, "60 s"),
      prefix: "factorlab:resend-verify",
      analytics: false,
    });

    const { success, reset } = await ratelimit.limit(email.toLowerCase());

    if (!success) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((reset - Date.now()) / 1000) || RESEND_VERIFICATION_COOLDOWN_SECONDS
      );

      return {
        allowed: false,
        error: buildResendCooldownMessage(retryAfterSeconds),
        retryAfterSeconds,
      };
    }

    return { allowed: true };
  } catch (err) {
    console.error("[rate-limit] Upstash error, allowing request:", err);
    return { allowed: true };
  }
}

/**
 * Check the per-IP account-creation rate limit using Upstash Redis.
 * Falls back to allowing all requests when Upstash env vars are not set
 * (e.g. local development without Redis configured).
 */
export async function checkAccountCreationRateLimit(ip: string): Promise<RateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn("[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — skipping rate limit");
    return { allowed: true };
  }

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");

    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "factorlab:account-creation",
      analytics: false,
    });

    const identifier = ip || "unknown";
    const { success } = await ratelimit.limit(identifier);

    if (!success) {
      return {
        allowed: false,
        error: "Too many account creations from your IP. Please try again in an hour.",
      };
    }

    return { allowed: true };
  } catch (err) {
    console.error("[rate-limit] Upstash error, allowing request:", err);
    return { allowed: true };
  }
}
