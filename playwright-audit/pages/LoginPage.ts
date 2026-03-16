import type { Page } from "@playwright/test"
import { BASE_URL } from "../audit.config"

export class LoginPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}/login`)
    await this.page.waitForSelector('#signin-email', { timeout: 30_000 })
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.page.locator('#signin-email').fill(email)
    await this.page.locator('#signin-password').fill(password)
    await this.page.locator('button[type="submit"]').filter({ hasText: /Sign in/i }).click()
    // Wait for navigation away from /login
    await this.page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  }

  async continueAsGuest(): Promise<void> {
    await this.page.locator('button:has-text("Continue as Guest")').click()
    await this.page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  }
}
