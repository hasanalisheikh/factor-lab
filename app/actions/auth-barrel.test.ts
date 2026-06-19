import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("auth server-action barrel", () => {
  it("does not reference imported type aliases in exported action signatures", () => {
    const source = readFileSync(join(process.cwd(), "app/actions/auth.ts"), "utf8");

    expect(source).not.toMatch(/export async function \w+\([^)]*:\s*AuthState/);
    expect(source).not.toMatch(/Promise<AuthState>/);
    expect(source).not.toMatch(/export async function \w+\([^)]*:\s*ForgotPasswordState/);
    expect(source).not.toMatch(/Promise<ForgotPasswordState>/);
    expect(source).not.toMatch(/export async function \w+\([^)]*:\s*ResendState/);
    expect(source).not.toMatch(/Promise<ResendState>/);
    expect(source).not.toMatch(/export async function \w+\([^)]*:\s*ResetPasswordState/);
    expect(source).not.toMatch(/Promise<ResetPasswordState>/);
  });
});
