import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("auth server-action barrel", () => {
  it("does not reference auth state type aliases in the server-action module", () => {
    const source = readFileSync(join(process.cwd(), "app/actions/auth.ts"), "utf8");

    expect(source).not.toMatch(/\bAuthState\b/);
    expect(source).not.toMatch(/\bForgotPasswordState\b/);
    expect(source).not.toMatch(/\bResendState\b/);
    expect(source).not.toMatch(/\bResetPasswordState\b/);
  });
});
