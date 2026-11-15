import { expect, test } from "@playwright/test";
import { computeCanonicalEventHash } from "@yen/shared";

test("Hindi verification result reflows at 360px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const fundId = "00000000-0000-4000-8000-000000000010";
  const event = {
    fund_id: fundId,
    seq: 1,
    type: "expense.submitted",
    version: 1,
    actor: "psn_00000000-0000-4000-8000-000000000002",
    occurred_at: "2026-10-28T00:00:00.000Z",
    payload: { amount_paise: 10000000 },
    prev_hash: "0".repeat(64),
    hash: "",
  };
  event.hash = await computeCanonicalEventHash(event);
  await page.route("**/records/*/proof", (route) =>
    route.fulfill({ json: { recordId: "demo", fundId, status: "pending", event } }),
  );
  await page.goto(`/verify?recordId=demo&fundId=${fundId}`);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByLabel("Language").selectOption("hi");
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("खाता बही में दर्ज; अगली सार्वजनिक मुहर की प्रतीक्षा में", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("₹1,00,000.00", { exact: true })).toBeVisible();
  await page.getByText("तकनीकी विवरण (लेखा परीक्षकों और जानकारों के लिए)", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath("hindi-result-360.png"), fullPage: true });
});
