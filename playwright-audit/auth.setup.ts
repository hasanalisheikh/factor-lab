import { test as setup } from "@playwright/test"
import { CREDENTIALS, BASE_URL } from "./audit.config"
import * as fs from "fs"
import * as path from "path"

const AUTH_FILE = "artifacts/results/.auth.json"
const USE_GUEST = !process.env.AUDIT_EMAIL || process.env.AUDIT_EMAIL === "audit@factorlab.local"

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })

  await page.goto(`${BASE_URL}/login`)
  await page.waitForSelector('text=/Sign in|Create Account|Continue as Guest/i', { timeout: 30_000 })

  if (USE_GUEST) {
    // No credentials configured — use guest session
    console.log("[auth] AUDIT_EMAIL not set — using guest session")
    const guestBtn = page.locator('button:has-text("Continue as Guest")')
    await guestBtn.waitFor({ state: "visible", timeout: 10_000 })
    await guestBtn.click()
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 })
    console.log(`[auth] Guest session active, landed at: ${page.url()}`)
  } else {
    // Email/password login
    console.log(`[auth] Signing in as ${CREDENTIALS.email}`)
    await page.locator("#signin-email").fill(CREDENTIALS.email)
    await page.locator("#signin-password").fill(CREDENTIALS.password)
    await page.locator('button[type="submit"]').filter({ hasText: /Sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 })
    console.log(`[auth] Signed in, landed at: ${page.url()}`)
  }

  await page.context().storageState({ path: AUTH_FILE })
  console.log(`[auth] Auth state saved to ${AUTH_FILE}`)
})
