import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 3137);
const apiPort = Number(process.env.E2E_API_PORT ?? 3939);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

/**
 * The suite drives the real pages against a seeded in-memory API, so it needs
 * no Postgres, queue or network access.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "./e2e/.results",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/stub-api.mjs",
      url: `${apiUrl}/health`,
      env: { E2E_API_PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `next start --port ${webPort}`,
      url: webUrl,
      env: { NEXT_PUBLIC_API_URL: apiUrl, PORT: String(webPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
