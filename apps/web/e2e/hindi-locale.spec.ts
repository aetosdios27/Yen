import { expect, test } from "@playwright/test";
import { fundId } from "./support/backend";

/**
 * Hindi QA: the app ships an explicit locale switcher (the browser locale
 * never overrides the product default, and the choice lives in React state
 * for the lifetime of the page), so this journey switches on the page under
 * test and drives the donation flow in Hindi.
 */
test.describe("hi-IN locale journey", () => {
  test("landing page switches to Hindi and updates html lang", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByLabel("Language").selectOption("hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("जाँच");
  });

  test("donation flow completes in Hindi", async ({ page }) => {
    const utr = `${(Date.now() % 900_000_000_000) + 100_000_000_000}`;
    await page.goto(`/funds/${fundId}/donate`);
    await page.getByLabel("Language").selectOption("hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");

    await page.getByRole("button", { name: "₹500", exact: true }).click();
    await page.getByLabel("12 अंकों का UPI संदर्भ").fill(utr);
    await page.getByRole("button", { name: "मेरा दान दर्ज करें" }).click();
    await expect(page.getByText("दान दर्ज हुआ, बैंक की पुष्टि बाकी है")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("verify page renders in Hindi", async ({ page }) => {
    await page.goto("/verify");
    await page.getByLabel("Language").selectOption("hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
