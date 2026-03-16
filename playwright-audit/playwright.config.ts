import { defineConfig, devices } from "@playwright/test"
import { BASE_URL } from "./audit.config"

export default defineConfig({
  testDir: "./tests",
  // Run tests serially — the audit is stateful and we don't want to
  // overwhelm the server with 162 parallel run creations.
  workers: 1,
  fullyParallel: false,

  // Generous global timeout: each test can create a run and wait for it to finish
  timeout: 45 * 60 * 1_000, // 45 min per test

  expect: {
    timeout: 30_000,
  },

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "artifacts/results/playwright-raw.json" }],
  ],

  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    video: "off",
    trace: "on-first-retry",
    // Allow generous navigation timeouts for slow Next.js pages
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },

  projects: [
    // Setup project: login once and save auth state.
    // Needs its own testDir so Playwright finds auth.setup.ts in the root.
    {
      name: "setup",
      testDir: ".",
      testMatch: /auth\.setup\.ts/,
    },
    // Main audit project: reuses saved auth state
    {
      name: "audit",
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "artifacts/results/.auth.json",
      },
    },
  ],

  outputDir: "artifacts/screenshots",
})
