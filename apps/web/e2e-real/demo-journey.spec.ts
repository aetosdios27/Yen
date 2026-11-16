import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUND_ID = "01940000-0000-7000-8000-000000000002";
const PIN = "482613";
const TREASURER = "+919876543210";
const APPROVER_ONE = "+919876543211";
const APPROVER_TWO = "+919876543212";
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? "3001"}`;
const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? join(HERE, ".results", "shots");
const BILL_PATH = join(HERE, "fixtures", "bill.png");

const PLEDGE_PAISE = 250000;
const EXPENSE_PAISE = 1250000 + Number(String(Date.now()).slice(-5));
const EXPENSE_RUPEES = `${BigInt(EXPENSE_PAISE) / 100n}.${String(BigInt(EXPENSE_PAISE) % 100n).padStart(2, "0")}`;
const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

interface Summary {
  raisedPaise: string;
  spentPaise: string;
  verification: string;
}

async function signIn(browser: Browser, phone: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toContainText("Simulated delivery");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByLabel("6-digit PIN").fill(PIN);
  const confirm = page.getByLabel("Confirm PIN");
  if (await confirm.isVisible()) await confirm.fill(PIN);
  await page.getByRole("button", { name: /Create PIN and continue|Unlock and continue/ }).click();
  await expect(page).toHaveURL(new RegExp(`/funds/${FUND_ID}/dashboard$`));
  return page;
}

async function shot(page: Page, name: string) {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: join(SHOTS_DIR, `${name}-${width}.png`), fullPage: true });
  }
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${API_URL}${path}`);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

async function postJson<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${API_URL}${path}`, {
    data,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

const statementDate = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getUTCDate())}/${pad(now.getUTCMonth() + 1)}/${now.getUTCFullYear()}`;
};

const statementCsv = (rows: string[]) =>
  ["Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance", ...rows].join(
    "\n",
  );

test("a donation, an approved expense and its bank debit end up anchored and publicly verifiable", async ({
  browser,
}) => {
  const run = String(Date.now());
  const pledgeUtr = run.slice(1);
  const debitUtr = String(BigInt(pledgeUtr) + 1n).padStart(12, "0");
  const purpose = `SBT kit and sensors for regional round ${run.slice(-6)}`;
  const anonymousDonor = await (await browser.newContext()).newPage();
  const treasurer = await signIn(browser, TREASURER);
  const before = await getJson<Summary>(treasurer.request, `/v1/funds/${FUND_ID}/public/summary`);

  await test.step("1. a donor pledges a UPI transfer and sees it awaiting the bank", async () => {
    await anonymousDonor.goto(`/funds/${FUND_ID}/donate`);
    await expect(anonymousDonor.getByText("iitd.robotics@sbi").first()).toBeVisible();
    await anonymousDonor.getByLabel("Another amount in rupees").fill("2500");
    await anonymousDonor.getByLabel("12-digit UPI reference").fill(pledgeUtr);
    await anonymousDonor.getByLabel("Name for the public record (optional)").fill("Meera Kapoor");
    await anonymousDonor.getByRole("button", { name: "Record my donation" }).click();
    await expect(anonymousDonor.getByText("Donation recorded, waiting for the bank")).toBeVisible();
    await expect(anonymousDonor.getByText("Nothing is spendable before that.")).toBeVisible();
    await shot(anonymousDonor, "01-donor-pledge-awaiting-bank");
  });

  await test.step("2. the bank statement credit is matched and the fund shows verified money", async () => {
    const result = await postJson<{ matchedCount: number; transactions: { type: string }[] }>(
      treasurer.request,
      "/v1/reconciliation/statements",
      {
        fundId: FUND_ID,
        csvContent: statementCsv([
          `${statementDate()},"UPI/CR/${pledgeUtr}/MEERA KAPOOR/OKAXIS/DONATION",${pledgeUtr},${statementDate()},,2500.00,0.00`,
        ]),
      },
    );
    expect(result.matchedCount).toBe(1);
    await treasurer.goto(`/funds/${FUND_ID}`);
    await expect(
      treasurer.getByText(inr(Number(before.raisedPaise) + PLEDGE_PAISE)).first(),
    ).toBeVisible();
    await expect(treasurer.getByText("M. K.").first()).toBeVisible();
    await shot(treasurer, "02-fund-shows-matched-donation");
  });

  let expenseId = "";
  const billBytes = Buffer.concat([readFileSync(BILL_PATH), Buffer.from(run)]);
  const billSha256 = createHash("sha256").update(billBytes).digest("hex");

  await test.step("3. the treasurer files an expense with a bill and an approver can open it", async () => {
    await treasurer.goto(`/funds/${FUND_ID}/expenses/new`);
    await treasurer.getByLabel("Amount (₹)").fill(EXPENSE_RUPEES);
    await treasurer.getByLabel("Payee name").fill("Robu.in Innovation Labs");
    await treasurer.getByLabel("Payee UPI VPA").fill("robu@ybl");
    await treasurer.getByLabel("Purpose").fill(purpose);
    await treasurer
      .getByLabel("Bill photo or PDF (optional)")
      .setInputFiles({ name: "bill.png", mimeType: "image/png", buffer: billBytes });
    await treasurer.getByRole("button", { name: "Review expense" }).click();
    await expect(treasurer.getByText("Review expense request")).toBeVisible();
    await shot(treasurer, "03a-expense-review-with-bill");
    await treasurer.getByRole("button", { name: "Submit expense" }).click();
    await expect(treasurer.getByRole("heading", { level: 1 })).toContainText("Treasurer dashboard");
    const row = treasurer.locator("li", { hasText: purpose });
    await expect(row).toBeVisible();
    const href = await row.getByRole("link").first().getAttribute("href");
    expenseId = href?.split("/").pop() ?? "";
    expect(expenseId).toMatch(/^[0-9a-f-]{36}$/);
    await shot(treasurer, "03b-treasurer-pending-expense");

    const evidence = await getJson<{ evidence: { fileSha256: string; mimeType: string }[] }>(
      treasurer.request,
      `/v1/funds/${FUND_ID}/expenses/${expenseId}/evidence`,
    );
    expect(evidence.evidence).toHaveLength(1);
    expect(evidence.evidence[0]).toMatchObject({ fileSha256: billSha256, mimeType: "image/png" });
  });

  await test.step("4. two approvers approve with the PIN once the objection window has closed", async () => {
    await expect
      .poll(
        async () =>
          (
            await getJson<{ objectionWindowOpen: boolean }>(
              treasurer.request,
              `/v1/funds/${FUND_ID}/expenses/${expenseId}`,
            )
          ).objectionWindowOpen,
        { timeout: 60_000, message: "the development objection window should close in seconds" },
      )
      .toBe(false);

    for (const [index, phone] of [APPROVER_ONE, APPROVER_TWO].entries()) {
      const approver = await signIn(browser, phone);
      await approver.goto(`/funds/${FUND_ID}/approvals/${expenseId}`);
      await expect(approver.getByText(purpose)).toBeVisible();
      const [bill] = await Promise.all([
        approver.waitForEvent("popup"),
        approver.getByRole("link", { name: "bill.png" }).click(),
      ]);
      await bill.waitForLoadState();
      const downloaded = await approver.request.get(bill.url());
      expect(downloaded.status()).toBe(200);
      expect(
        createHash("sha256")
          .update(await downloaded.body())
          .digest("hex"),
      ).toBe(billSha256);
      await bill.close();
      await shot(approver, `04${"ab"[index]}-approver-${index + 1}-reviews-bill`);

      await approver.getByRole("button", { name: "Approve", exact: true }).click();
      const dialog = approver.getByRole("dialog");
      await dialog.getByLabel("Approval PIN").fill(PIN);
      await dialog.getByRole("button", { name: "Confirm approval" }).click();
      await expect(approver.getByText("Expense successfully approved")).toBeVisible();
      await expect(approver.getByText(`Approvals (${index + 1} of 2)`)).toBeVisible();
      await shot(approver, `04${"cd"[index]}-approver-${index + 1}-approved`);
      await approver.context().close();
    }
    const approved = await getJson<{ status: string; approvalsCount: number }>(
      treasurer.request,
      `/v1/funds/${FUND_ID}/expenses/${expenseId}`,
    );
    expect(approved).toMatchObject({ status: "approved", approvalsCount: 2 });
  });

  let bankTransactionId = "";
  await test.step("5. the bank debit settles the expense and is reconciled", async () => {
    await treasurer.goto(`/funds/${FUND_ID}/dashboard`);
    await expect(treasurer.locator("li", { hasText: purpose })).toBeVisible();
    const balances = await getJson<{
      bankPaise: string;
      reservedPaise: string;
      availablePaise: string;
    }>(treasurer.request, `/v1/funds/${FUND_ID}/balances`);
    expect(BigInt(balances.reservedPaise)).toBeGreaterThanOrEqual(BigInt(EXPENSE_PAISE));
    expect(BigInt(balances.availablePaise)).toBe(
      BigInt(balances.bankPaise) - BigInt(balances.reservedPaise),
    );
    await shot(treasurer, "05a-approved-reservation-retained");
    const baseline = process.env.E2E_BEFORE_WEB_URL;
    if (baseline) {
      await treasurer.goto(`${baseline}/funds/${FUND_ID}/dashboard`);
      await expect(treasurer.getByText("Spendable balance")).toBeVisible();
      await expect(treasurer.locator("li", { hasText: purpose })).toHaveCount(0);
      await shot(treasurer, "before-approved-expense-missing");
    }
    await treasurer.goto(`/funds/${FUND_ID}/approvals/${expenseId}`);
    await expect(treasurer.getByRole("heading", { name: "Match the bank payment" })).toBeVisible();
    await shot(treasurer, "05b-bank-match-action");
    const csv = statementCsv([
      `${statementDate()},"UPI/DR/${debitUtr}/robu@ybl/Robu.in Innovation Labs",${debitUtr},${statementDate()},${EXPENSE_RUPEES},,0.00`,
    ]);
    await treasurer.getByLabel("Bank statement CSV").setInputFiles({
      name: "bank-statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await treasurer.getByRole("button", { name: "Import and match statement" }).click();
    await expect(treasurer.getByLabel("Bank statement CSV")).toHaveCount(0);
    const paid = await getJson<{ status: string; bankTransactionId: string }>(
      treasurer.request,
      `/v1/funds/${FUND_ID}/expenses/${expenseId}`,
    );
    expect(paid.status).toBe("paid");
    bankTransactionId = paid.bankTransactionId;

    const reconciled = await postJson<{ status: string }>(
      treasurer.request,
      `/v1/funds/${FUND_ID}/expenses/${expenseId}/reconcile`,
      { bankTransactionId },
    );
    expect(reconciled.status).toBe("reconciled");
    await treasurer.goto(`/funds/${FUND_ID}/approvals/${expenseId}`);
    await expect(treasurer.getByText("This request has already been approved")).toBeVisible();
    await shot(treasurer, "05-expense-settled-and-reconciled");
  });

  await test.step("6. the worker anchors the new events on the local chain", async () => {
    await expect
      .poll(
        async () =>
          (await getJson<Summary>(treasurer.request, `/v1/funds/${FUND_ID}/public/summary`))
            .verification,
        {
          timeout: 4 * 60_000,
          intervals: [5_000],
          message: "the worker should anchor the records",
        },
      )
      .toBe("anchored");
    await treasurer.goto(`/funds/${FUND_ID}`);
    await expect(treasurer.getByText("All bank matches anchored")).toBeVisible();
    await shot(treasurer, "06-records-anchored");
  });

  await test.step("7. the public fund page and verify page show the money and the on-chain proof", async () => {
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`/funds/${FUND_ID}`);
    await expect(
      visitor.getByText(inr(Number(before.raisedPaise) + PLEDGE_PAISE)).first(),
    ).toBeVisible();
    await expect(
      visitor.getByText(inr(Number(before.spentPaise) + EXPENSE_PAISE)).first(),
    ).toBeVisible();
    await shot(visitor, "07a-public-fund-page");

    const spend = visitor.locator("li", { hasText: "An expense was marked reconciled." }).last();
    await spend.getByRole("link", { name: "Check this record" }).click();
    await expect(visitor).toHaveURL(/\/verify\?/);
    await expect(visitor.getByTestId("simulated-chain-notice")).toHaveText(
      "Simulated local chain, not a public network",
    );
    await expect(visitor.getByText("This record was written on")).toBeVisible();
    await expect(visitor.getByText("Public registry seal verified")).toBeVisible();
    await shot(visitor, "07b-verify-page");
  });
});
