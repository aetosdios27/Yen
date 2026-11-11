import { expect, test } from "@playwright/test";
import { fundId } from "./support/backend";
import {
  setHardwareCpuThrottling,
  setSlowNetworkConditions,
} from "./support/virtual-authenticator";

/**
 * Low-end Android QA profile: Moto G4-class hardware (4x CPU slowdown) on a
 * regular 3G connection (Lighthouse preset: 1.6 Mbps down, 750 Kbps up,
 * 150 ms RTT). Chromium only: the throttling controls are Chrome DevTools
 * Protocol domains, and throughput values are bytes per second.
 */
test.describe("moto g4 low-end profile", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP throttling is Chromium only");

  test.beforeEach(async ({ page }) => {
    await setHardwareCpuThrottling(page, 4);
    await setSlowNetworkConditions(page, {
      latency: 150,
      downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
      uploadThroughput: Math.floor((750 * 1024) / 8),
    });
  });

  test("fund page stays usable at 4x CPU slowdown on slow 3G", async ({ page }) => {
    await page.goto(`/funds/${fundId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Total raised|Raised/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("donation flow completes under throttling", async ({ page }) => {
    const utr = `${(Date.now() % 900_000_000_000) + 100_000_000_000}`;
    await page.goto(`/funds/${fundId}/donate`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "₹500", exact: true }).click();
    await page.getByLabel("12-digit UPI reference").fill(utr);
    await page.getByRole("button", { name: "Record my donation" }).click();
    await expect(page.getByText("Donation recorded, waiting for the bank")).toBeVisible({
      timeout: 45_000,
    });
  });

  test("verify page renders under throttling", async ({ page }) => {
    await page.goto("/verify", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  });
});
