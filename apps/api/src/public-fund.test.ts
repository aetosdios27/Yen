import { type ExpenseRequest, InMemoryExpenseStore } from "@yen/ledger";
import { type Actor, can, redact, redactFundReadModel } from "@yen/policy";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  type AppDependencies,
  type DisplayNameStore,
  MemoryPublicFundReadStore,
  MemoryDisplayNameStore,
} from "./dependencies.js";
import { devPolicy } from "./policy.js";

const owner = { id: "00000000-0000-4000-8000-000000000001", role: "owner" as const };
const fundId = "00000000-0000-4000-8000-000000000010";

function fixtureApp(
  displayNameStore: DisplayNameStore = new MemoryDisplayNameStore(),
  principalValue: AppDependencies["principal"] = owner,
  publicFundReadStore = new MemoryPublicFundReadStore(),
) {
  const expenses = new InMemoryExpenseStore();
  const expense = {
    id: "00000000-0000-4000-8000-000000000020",
    fundId,
    requesterId: "psn_00000000-0000-4000-8000-000000000021" as ExpenseRequest["requesterId"],
    amountPaise: paise(2500),
    description: "fixture expense",
    recipientRef: "private payee account 1234567890123456",
    status: "paid",
    holdId: null,
    approvals: [],
    evidence: [
      { evidenceId: "00000000-0000-4000-8000-000000000030", contentSha256: "a".repeat(64) },
    ],
    supersedesId: null,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    submittedAt: "2026-10-28T00:00:00.000Z",
    objectionEndsAt: null,
    approvedAt: "2026-10-28T00:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: "2026-10-28T00:00:00.000Z",
    reconciledAt: null,
    bankTransactionId: "private-utr-ABCDEF123456789",
    expiresAt: null,
    phone: "+919876543210",
    utr: "ABCDEF123456789",
    payeeAccount: "1234567890123456",
    evidenceUrl: "https://files.example/private-bill.pdf",
  } as unknown as ExpenseRequest;
  const app = createApp({
    principal: principalValue,
    idGenerator: () => fundId,
    policy: devPolicy,
    displayNameStore,
    publicFundReadStore,
    expenseStore: {
      ...expenses,
      get: expenses.get.bind(expenses),
      list: async (id: string) => (id === fundId ? [expense] : []),
      save: expenses.save.bind(expenses),
      atomicApprove: expenses.atomicApprove.bind(expenses),
    } as AppDependencies["expenseStore"],
  });
  return app;
}

async function createPublicFund(app: ReturnType<typeof createApp>) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "public-fixture" },
    body: JSON.stringify({
      name: "Community fund",
      purpose:
        "Phone +919876543210; UTR ABCDEF123456789; account number 1234567890123456; https://files.example/private-bill.pdf",
      visibility: "public",
      targetPaise: "9000",
      upiVpa: "committee@yenbank",
      upiPayeeName: "Committee",
    }),
  });
  expect(response.status).toBe(201);
}

describe("public fund read API", () => {
  it("returns summary, categorized spending, and a plain language unverified timeline privately to an authenticated owner", async () => {
    const app = fixtureApp();
    await createPublicFund(app);
    const summary = await app.request(`/v1/funds/${fundId}/public/summary`);
    expect(summary.status).toBe(200);
    expect(summary.headers.get("cache-control")).toBe("private, no-store");
    expect(summary.headers.get("etag")).toBeNull();
    const summaryText = await summary.text();
    expect(JSON.parse(summaryText)).toMatchObject({
      fundId,
      name: "Community fund",
      raisedPaise: "0",
      spentPaise: "2500",
      verification: "unverified",
    });

    const breakdown = await app.request(`/v1/funds/${fundId}/public/breakdown`);
    const breakdownText = await breakdown.text();
    expect(JSON.parse(breakdownText)).toMatchObject({
      categories: [{ category: "Other", spentPaise: "2500", transactionCount: 1 }],
    });
    const timeline = await app.request(`/v1/funds/${fundId}/public/timeline`);
    const timelineText = await timeline.text();
    expect(JSON.parse(timelineText)).toMatchObject({
      items: [{ message: "An approved expense was marked paid.", verified: "unverified" }],
    });

    const allResponses = [summaryText, breakdownText, timelineText].join("\n");
    for (const secret of [
      "+919876543210",
      "ABCDEF123456789",
      "1234567890123456",
      "https://files.example/private-bill.pdf",
      "committee@yenbank",
    ]) {
      expect(allResponses).not.toContain(secret);
    }
  });

  it("returns zero rather than a stub when a fund has no verified donations", async () => {
    const app = fixtureApp();
    await createPublicFund(app);
    const response = await app.request(`/v1/funds/${fundId}/public/summary`);
    const body = (await response.json()) as { dataGaps: string[]; raisedPaise: string | null };
    expect(body.raisedPaise).toBe("0");
    expect(body.dataGaps).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Donation records are not queryable")]),
    );
  });

  it("uses verified bank credits and applies every donor display preference", async () => {
    const donations = new MemoryPublicFundReadStore();
    donations.set(fundId, [
      {
        id: "00000000-0000-4000-8000-000000000051",
        occurredAt: "2026-10-28T01:00:00.000Z",
        amountPaise: 1500n,
        donorDisplayName: "Aarav Sharma",
        donorNameChoice: "full",
      },
      {
        id: "00000000-0000-4000-8000-000000000052",
        occurredAt: "2026-10-28T02:00:00.000Z",
        amountPaise: 2500n,
        donorDisplayName: "Beena Kumari",
        donorNameChoice: "initials",
      },
      {
        id: "00000000-0000-4000-8000-000000000053",
        occurredAt: "2026-10-28T03:00:00.000Z",
        amountPaise: 3000n,
        donorDisplayName: "Private Donor",
        donorNameChoice: "anonymous",
      },
    ]);
    const app = fixtureApp(new MemoryDisplayNameStore(), owner, donations);
    await createPublicFund(app);
    const summary = (await app.request(`/v1/funds/${fundId}/public/summary`)).json();
    await expect(summary).resolves.toMatchObject({ raisedPaise: "7000", verification: "bank-matched" });
    const timeline = (await app.request(`/v1/funds/${fundId}/public/timeline`)).json();
    await expect(timeline).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "00000000-0000-4000-8000-000000000051", actorDisplayName: "Aarav Sharma" }),
        expect.objectContaining({ id: "00000000-0000-4000-8000-000000000052", actorDisplayName: "B. K." }),
        expect.not.objectContaining({ actorDisplayName: "Private Donor" }),
      ]),
    });
  });

  it("resolves timeline labels from the display-name store and honors the fund officeholder setting", async () => {
    const names = new MemoryDisplayNameStore();
    names.set(fundId, "psn_00000000-0000-4000-8000-000000000021", "Aarav Sharma");
    const app = fixtureApp(names);
    await createPublicFund(app);
    const initialsResponse = await app.request(`/v1/funds/${fundId}/public/timeline`);
    const initialsBody = JSON.parse(await initialsResponse.text()) as {
      items: { actorDisplayName?: string }[];
    };
    expect(initialsBody.items[0]?.actorDisplayName).toBe("A. S.");

    names.setOfficeholderNamesShown(fundId, true);
    const fullNameResponse = await app.request(`/v1/funds/${fundId}/public/timeline`);
    const fullNameBody = JSON.parse(await fullNameResponse.text()) as {
      items: { actorDisplayName?: string }[];
    };
    expect(fullNameBody.items[0]?.actorDisplayName).toBe("Aarav Sharma");
  });

  it("redacts private fields from every source record and from aggregate projection extras", () => {
    const actor: Actor = { role: "public" };
    const donation = redact(actor, {
      donationId: "donation-1",
      fundId,
      amountPaise: paise(500),
      donorPseudonymId: "psn_00000000-0000-4000-8000-000000000041",
      donorDisplayName: "Donor Name",
      donorPhone: "+919876543210",
      donorEmail: "donor@example.test",
      bankTransactionId: "ABCDEF123456789",
      createdAt: "2026-10-28T00:00:00.000Z",
    });
    const expense = redact(actor, {
      expenseId: "expense-1",
      fundId,
      amountPaise: paise(100),
      payeeName: "Vendor",
      createdAt: "2026-10-28T00:00:00.000Z",
      evidence: [{ contentSha256: "b".repeat(64), fileUrl: "https://files.example/secret.pdf" }],
      phone: "+919876543210",
      utr: "ABCDEF123456789",
      payeeAccount: "1234567890123456",
    } as never);
    const aggregate = redactFundReadModel(actor, {
      kind: "fund_summary",
      fundId,
      name: "Fund",
      purpose:
        "Phone +919876543210; UTR ABCDEF123456789; account number 1234567890123456; https://files.example/secret.pdf",
      raisedPaise: null,
      spentPaise: "0",
      verification: "unverified",
      dataGaps: [],
      phone: "+919876543210",
      utr: "ABCDEF123456789",
      payeeAccount: "1234567890123456",
      evidenceUrl: "https://files.example/secret.pdf",
    } as never);
    const bytes = JSON.stringify({ donation, expense, aggregate });
    for (const secret of [
      "+919876543210",
      "ABCDEF123456789",
      "1234567890123456",
      "https://files.example/secret.pdf",
      "donor@example.test",
    ]) {
      expect(bytes).not.toContain(secret);
    }
    expect(donation).toHaveProperty("donorPseudonymId");
    expect(expense.evidence?.[0]).not.toHaveProperty("fileUrl");
    expect(aggregate.purpose).toContain("[redacted]");
  });

  it("enforces visibility tiers with the policy engine", () => {
    const resource = (visibilityTier: "public" | "donors" | "members" | "private") => ({
      kind: "fund" as const,
      fund: {
        policy: { visibilityTier, approvalQuorum: 1 },
      },
    });
    expect(can({ role: "public" }, "fund:read", resource("public"))).toBe(true);
    expect(can({ role: "public" }, "fund:read", resource("donors"))).toBe(false);
    expect(can({ role: "donor" }, "fund:read", resource("donors"))).toBe(true);
    expect(can({ role: "donor" }, "fund:read", resource("members"))).toBe(false);
    expect(can({ role: "member" }, "fund:read", resource("donors"))).toBe(true);
    expect(can({ role: "member" }, "fund:read", resource("members"))).toBe(true);
    expect(can({ role: "member" }, "fund:read", resource("private"))).toBe(false);
    expect(can({ role: "approver" }, "fund:read", resource("members"))).toBe(true);
    expect(can({ role: "approver" }, "fund:read", resource("private"))).toBe(true);
  });
});
