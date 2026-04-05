import { beforeEach, describe, expect, it, vi } from "vitest";

const { upgradeGuestToEmailPasswordMock } = vi.hoisted(() => ({
  upgradeGuestToEmailPasswordMock: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  upgradeGuestToEmailPassword: upgradeGuestToEmailPasswordMock,
}));

import { upgradeGuestAction } from "@/app/actions/account";

describe("account guest upgrade action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates settings-page guest upgrades to the shared auth upgrade flow", async () => {
    upgradeGuestToEmailPasswordMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "Password!");
    formData.set("confirm_password", "Password!");

    await expect(upgradeGuestAction(null, formData)).resolves.toBeNull();
    expect(upgradeGuestToEmailPasswordMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password!",
    });
  });

  it("returns shared upgrade errors back to the settings form", async () => {
    upgradeGuestToEmailPasswordMock.mockResolvedValue({
      error: "An account with this email already exists. Sign in to that account instead.",
    });

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "Password!");
    formData.set("confirm_password", "Password!");

    await expect(upgradeGuestAction(null, formData)).resolves.toEqual({
      error: "An account with this email already exists. Sign in to that account instead.",
    });
  });
});
