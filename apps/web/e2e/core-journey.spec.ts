import { expect, test } from "@playwright/test";

const fundId = "00000000-0000-4000-8000-0000000000f1";
const expenseId = "00000000-0000-4000-8000-0000000000e1";
const apiUrl = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 3939}`;

test.describe("club lifecycle", () => {
  test("a visitor sees the fund balance and how the money was spent", async ({ page }) => {
    await page.goto(`/funds/${fundId}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("RoboCup 2026 Asia Fund");
    await expect(page.getByText("Total raised")).toBeVisible();
    await expect(page.getByText("₹2,50,000.00").first()).toBeVisible();
    await expect(page.getByText("₹75,000.00").first()).toBeVisible();
    await expect(page.getByText("A donation was bank matched.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Donate via UPI/i })).toBeVisible();
  });

  test("a donor pledges a UPI transfer and is told it awaits the bank", async ({ page }) => {
    await page.goto(`/funds/${fundId}/donate`);

    await page.getByRole("button", { name: "₹500", exact: true }).click();
    await page.getByLabel("12-digit UPI reference").fill("123456789012");
    await page.getByLabel("Name for the public record (optional)").fill("Asha");
    await page.getByRole("button", { name: "Record my donation" }).click();

    await expect(page.getByText("Donation recorded, waiting for the bank")).toBeVisible();
    await expect(
      page.getByText("We'll confirm this when the bank statement reflects it.", { exact: false }),
    ).toBeVisible();

    const state = await (await page.request.get(`${apiUrl}/__state`)).json();
    expect(state.pledges).toHaveLength(1);
    expect(state.pledges[0]).toMatchObject({ amountPaise: 50000, utr: "123456789012" });
  });

  test("a treasurer files an expense request that approvers must review", async ({ page }) => {
    await page.goto(`/funds/${fundId}/expenses/new`);

    await page.getByLabel("Amount (₹)").fill("2500");
    await page.getByLabel("Payee name").fill("Ramesh Electricals");
    await page.getByLabel("Payee UPI VPA").fill("ramesh@yenbank");
    await page.getByLabel("Purpose").fill("Community hall light fixtures");
    await page.getByRole("button", { name: "Review expense" }).click();

    await expect(page.getByText("Review expense request")).toBeVisible();
    await page.getByRole("button", { name: "Submit expense" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Treasurer dashboard");

    const state = await (await page.request.get(`${apiUrl}/__state`)).json();
    expect(
      state.expenses.some((expense: { amountPaise: number }) => expense.amountPaise === 250000),
    ).toBe(true);
  });

  test("an approver releases an expense only after the six digit PIN", async ({ page }) => {
    await page.goto(`/funds/${fundId}/approvals/${expenseId}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Expense approval request");
    await expect(page.getByText("Stage audio monitors")).toBeVisible();
    await expect(page.getByText("₹2,500.00", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const pinDialog = page.getByRole("dialog");
    await expect(pinDialog.getByText("Enter 6-digit approval PIN")).toBeVisible();

    await pinDialog.getByLabel("Approval PIN").fill("12345");
    await pinDialog.getByRole("button", { name: "Confirm approval" }).click();
    await expect(pinDialog.getByText("PIN must be exactly 6 digits")).toBeVisible();

    await pinDialog.getByLabel("Approval PIN").fill("123456");
    await pinDialog.getByRole("button", { name: "Confirm approval" }).click();

    await expect(page.getByText(/approved/i).first()).toBeVisible();
  });

  test("a club sets up its fund and invites two co-approvers", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/onboarding");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Set up your club fund");
    await page.getByLabel("Club or organisation name").fill("Robotics Club");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Fund purpose").fill("Send the team to the regional championship");
    await page.getByLabel("Target amount in paise").fill("5000000");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("UPI VPA").fill("robotics@yenbank");
    await page.getByLabel("Bank account or UPI payee name").fill("Robotics Club");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Approver 1 name").fill("Asha Rao");
    await page.getByLabel("Approver 1 phone number").fill("+919876543210");
    await page.getByLabel("Approver 2 name").fill("Vikram Singh");
    await page.getByLabel("Approver 2 phone number").fill("+919876543211");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("radio", { name: /Public/ }).check();
    await page.getByRole("button", { name: "Create fund" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your fund is ready");
    await expect(
      page.getByRole("link", { name: "Share approver invite 2 on WhatsApp" }),
    ).toBeVisible();
  });

  test("the same UPI reference cannot be recorded twice", async ({ page }) => {
    await page.request.post(`${apiUrl}/v1/funds/${fundId}/donations/pledge`, {
      data: { amountPaise: "50000", utr: "999888777666" },
      headers: { "Idempotency-Key": "seed-duplicate" },
    });

    await page.goto(`/funds/${fundId}/donate`);
    await page.getByRole("button", { name: "₹500", exact: true }).click();
    await page.getByLabel("12-digit UPI reference").fill("999888777666");
    await page.getByRole("button", { name: "Record my donation" }).click();

    await expect(page.getByText("This UPI reference is already recorded.")).toBeVisible();
  });
});
