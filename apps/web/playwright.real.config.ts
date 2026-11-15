import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.WEB_PORT ?? "3000";

/**
 * Drives the real stack started by `pnpm dev:full` (web, API, PostgreSQL, queue worker and
 * local chain). Nothing is started here and no stub API is involved.
 */
export default defineConfig({
  testDir: "./e2e-real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60_000,
  reporter: [["list"]],
  outputDir: "./e2e-real/.results",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? `http://localhost:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
