import { defineConfig, devices } from "@playwright/test";

/** Where the suite's server listens: the compiled server, as in production. */
export const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

/**
 * The end-to-end suite (npm run test:e2e). It runs against what users get:
 * the production client build, served by the compiled server with
 * NODE_ENV=production, so the headers and the Content-Security-Policy are
 * the real ones. Each test makes its own room, so tests never depend on one
 * another and run in parallel. The restart test runs its own server (see
 * server.ts), since it has to stop and start it.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A flaky test is a bug to fix, not to retry.
  retries: 0,
  outputDir: "../test-results",
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "../playwright-report" }],
      ]
    : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    // Built first, so a run never tests a stale build.
    command:
      "npm run build:web && npm run build:server && node dist/server/main.js",
    cwd: "..",
    url: `${BASE_URL}/health`,
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(PORT),
      LOG_LEVEL: "warn",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
