import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 3137);
const apiPort = Number(process.env.E2E_API_PORT ?? 3939);
const proxyPort = Number(process.env.E2E_PROXY_PORT ?? 3940);
const realBackend = process.env.E2E_BACKEND === "real";
const stubHost = "127.0.0.1";
const sharedHost = "localhost";
// Real mode serves the browser from localhost because the API verifies WebAuthn
// assertions against WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN, and an RP ID must be a
// domain, so the journey pages and the virtual authenticator both live on
// http://localhost:<port>.
const webHost = realBackend ? sharedHost : stubHost;
const apiUrl = `http://${stubHost}:${apiPort}`;
const browserApiUrl = realBackend
  ? `http://${sharedHost}:${proxyPort}`
  : `http://${stubHost}:${apiPort}`;
const webUrl = `http://${webHost}:${webPort}`;

/**
 * Two modes:
 * - mock (default): the real pages against a seeded in-memory stub API, no
 *   Postgres, queue or network access.
 * - real (E2E_BACKEND=real): the real Hono API on a Postgres database reached
 *   through a CORS edge, so the browser journeys, passkey registration and
 *   Merkle verification run against the production code paths.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "./e2e/.results",
  ...(realBackend ? { globalSetup: "./e2e/support/real-backend-global-setup.ts" } : {}),
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "moto-g4", use: { ...devices["Moto G4"] } },
    { name: "iphone-13", use: { ...devices["iPhone 13"] } },
    { name: "hi-in", use: { ...devices["Desktop Chrome"], locale: "hi-IN" } },
  ],
  webServer: realBackend
    ? [
        {
          command: `pnpm --filter @yen/api build && pnpm --filter @yen/api exec node ../../web/e2e/support/real-api-server.mjs`,
          url: `${apiUrl}/health`,
          env: {
            NODE_ENV: "development",
            PORT: String(apiPort),
            DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
            PAYEE_FINGERPRINT_SALT:
              process.env.E2E_PAYEE_FINGERPRINT_SALT ?? "e2e-payee-fingerprint-salt-0123456789",
            WEBAUTHN_RP_ID: sharedHost,
            WEBAUTHN_ORIGIN: webUrl,
            WEBAUTHN_RP_NAME: "Yen",
            ENABLE_MOCK_PAYOUTS: "true",
            PLEDGE_RATE_LIMIT_CAPACITY: "1000",
            PLEDGE_RATE_LIMIT_REFILL_MS: "1000",
            RATE_LIMIT_IP_CAPACITY: "5000",
            RATE_LIMIT_PRINCIPAL_CAPACITY: "5000",
          },
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          timeout: 120_000,
        },
        {
          command: "exec node e2e/support/cors-proxy.mjs",
          url: `${proxyUrl}/health`,
          env: {
            E2E_PROXY_PORT: String(proxyPort),
            E2E_API_PORT: String(apiPort),
            E2E_WEB_PORT: String(webPort),
          },
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          timeout: 30_000,
        },
        {
          command: `pnpm run build && exec node node_modules/next/dist/bin/next start --port ${webPort} --hostname 0.0.0.0`,
          url: webUrl,
          env: { NEXT_PUBLIC_API_URL: browserApiUrl, PORT: String(webPort) },
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          timeout: 120_000,
        },
      ]
    : [
        {
          command: "exec node e2e/support/stub-api.mjs",
          url: `${apiUrl}/health`,
          env: { E2E_API_PORT: String(apiPort) },
          reuseExistingServer: !process.env.CI,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          timeout: 30_000,
        },
        {
          command: `pnpm run build && exec node node_modules/next/dist/bin/next start --port ${webPort}`,
          url: webUrl,
          env: { NEXT_PUBLIC_API_URL: apiUrl, PORT: String(webPort) },
          reuseExistingServer: !process.env.CI,
          gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          timeout: 120_000,
        },
      ],
});
