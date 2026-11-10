import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { fundId } from "./support/backend";

type AxeViolation = { id: string; impact: string | null; nodes: unknown[] };

const blockedImpact = new Set(["critical", "serious"]);

async function seriousViolations(page: Page): Promise<AxeViolation[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag21aa"]).analyze();
  return results.violations.filter((violation) => blockedImpact.has(violation.impact ?? ""));
}

test.describe("accessibility (WCAG 2.1 AA, zero critical or serious violations)", () => {
  test("landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("public fund view", async ({ page }) => {
    await page.goto(`/funds/${fundId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("donation page", async ({ page }) => {
    await page.goto(`/funds/${fundId}/donate`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("fund dashboard", async ({ page }) => {
    await page.goto(`/funds/${fundId}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("public verify page", async ({ page }) => {
    await page.goto("/verify");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
