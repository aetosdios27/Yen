import { randomInt } from "node:crypto";
import { appendEvent, migrate, uuidv7 } from "@yen/db";
import { payloadSchemas, pseudonymIdSchema } from "@yen/eventlog";
import { getBalances, pledgeDonation, reconcilePledge } from "@yen/ledger";
import { fundIdSchema, paise } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { PostgresPublicFundReadStore } from "./public-fund-store.js";

let nextUtr = 100_000_000_000;

databaseSuite("Postgres public fund read store", (sql) => {
  const store = () => new PostgresPublicFundReadStore(sql);

  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
  });

  async function fund(): Promise<string> {
    const userId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Test User')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Test Org', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Test Fund', '{}'::jsonb)`;
    return fundId;
  }

  async function pledge(
    fundId: string,
    status: "pledged" | "verified",
    donor: { name: string; choice: "full" | "initials" | "anonymous" },
    amountPaise: number,
  ): Promise<string> {
    const id = uuidv7();
    const utr = String(nextUtr++);
    await sql`
      INSERT INTO donation_pledges
        (id, fund_id, amount_paise, utr, donor_display_name, donor_name_choice, status)
      VALUES (${id}, ${fundId}, ${amountPaise}, ${utr}, ${donor.name}, ${donor.choice}, ${status})
    `;
    return id;
  }

  async function bankTransaction(input: {
    fundId: string;
    type: "credit" | "debit";
    amountPaise: number;
    postedAt: string;
    reconciliationStatus: "unmatched" | "matched";
    matchedPledgeId: string | null;
  }): Promise<string> {
    const id = uuidv7();
    const matched = input.reconciliationStatus === "matched";
    await sql`
      INSERT INTO bank_transactions
        (id, fund_id, bank_reference, utr, amount_paise, type, posted_at, source, raw_payload,
         reconciliation_status, matched_pledge_id, matched_at, match_method)
      VALUES (
        ${id}, ${input.fundId}, ${`ref-${id}`}, ${null}, ${input.amountPaise}, ${input.type},
        ${new Date(input.postedAt)}, 'statement_upload', '{}'::jsonb,
        ${input.reconciliationStatus}, ${input.matchedPledgeId},
        ${matched ? new Date(input.postedAt) : null}, ${matched ? "exact_utr" : null}
      )
    `;
    return id;
  }

  it("returns only bank-matched credits on verified pledges for the requested fund", async () => {
    const fundA = await fund();
    const fundB = await fund();

    const verifiedDonor = { name: "Aarav Sharma", choice: "full" as const };
    const verifiedPledge = await pledge(fundA, "verified", verifiedDonor, 1500);
    const includedId = await bankTransaction({
      fundId: fundA,
      type: "credit",
      amountPaise: 1500,
      postedAt: "2026-10-28T01:00:00.000Z",
      reconciliationStatus: "matched",
      matchedPledgeId: verifiedPledge,
    });

    const stillPledged = await pledge(
      fundA,
      "pledged",
      { name: "Unconfirmed Donor", choice: "full" },
      700,
    );
    await bankTransaction({
      fundId: fundA,
      type: "credit",
      amountPaise: 700,
      postedAt: "2026-10-28T02:00:00.000Z",
      reconciliationStatus: "matched",
      matchedPledgeId: stillPledged,
    });

    await bankTransaction({
      fundId: fundA,
      type: "credit",
      amountPaise: 800,
      postedAt: "2026-10-28T03:00:00.000Z",
      reconciliationStatus: "unmatched",
      matchedPledgeId: null,
    });

    const debitPledge = await pledge(fundA, "verified", { name: "Payee", choice: "initials" }, 900);
    await bankTransaction({
      fundId: fundA,
      type: "debit",
      amountPaise: 900,
      postedAt: "2026-10-28T04:00:00.000Z",
      reconciliationStatus: "matched",
      matchedPledgeId: debitPledge,
    });

    const otherPledge = await pledge(
      fundB,
      "verified",
      { name: "Other Fund Donor", choice: "full" },
      4000,
    );
    await bankTransaction({
      fundId: fundB,
      type: "credit",
      amountPaise: 4000,
      postedAt: "2026-10-28T05:00:00.000Z",
      reconciliationStatus: "matched",
      matchedPledgeId: otherPledge,
    });

    expect(await store().pledgedPaise(fundA)).toBe(700n);
    expect(await store().donations(fundA)).toEqual([
      {
        id: includedId,
        occurredAt: "2026-10-28T01:00:00.000Z",
        amountPaise: 1500n,
        donorDisplayName: "Aarav Sharma",
        donorNameChoice: "full",
      },
    ]);
  });

  it("keeps public totals equal to ledger balances across pledge reconciliation", async () => {
    const fundId = await fund();
    const result = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId, amount: paise(5000), utr: String(nextUtr++) }),
    );
    if (result.kind !== "pledged") throw new Error("Expected pledge");
    const before = await getBalances(sql, fundId);
    expect(await store().pledgedPaise(fundId)).toBe(before.pledgedPaise);
    expect(await store().donations(fundId)).toEqual([]);
    expect(before.availablePaise).toBe(0n);
    const bankId = await bankTransaction({
      fundId,
      type: "credit",
      amountPaise: 5000,
      postedAt: "2026-10-28T01:00:00.000Z",
      reconciliationStatus: "unmatched",
      matchedPledgeId: null,
    });
    await sql.begin((tx) =>
      reconcilePledge(tx, {
        fundId,
        pledgeId: result.donationId,
        bankTransactionId: bankId,
        matchMethod: "manual",
        matchConfidence: 1,
        auditReason: "Confirmed",
      }),
    );
    const after = await getBalances(sql, fundId);
    const total = (await store().donations(fundId)).reduce(
      (sum, item) => sum + item.amountPaise,
      0n,
    );
    expect(total).toBe(after.donationsPaise);
    expect(total).toBe(after.availablePaise);
    expect(await store().pledgedPaise(fundId)).toBe(after.pledgedPaise);
  });

  it("requires a confirmed anchor over the matching financial event for donations and reconciled expenses", async () => {
    const fundId = fundIdSchema.parse(await fund());
    const pledgeId = await pledge(fundId, "verified", { name: "Donor", choice: "initials" }, 1500);
    const creditId = await bankTransaction({
      fundId,
      type: "credit",
      amountPaise: 1500,
      postedAt: "2026-10-28T01:00:00.000Z",
      reconciliationStatus: "matched",
      matchedPledgeId: pledgeId,
    });
    const debitId = await bankTransaction({
      fundId,
      type: "debit",
      amountPaise: 500,
      postedAt: "2026-10-28T02:00:00.000Z",
      reconciliationStatus: "unmatched",
      matchedPledgeId: null,
    });
    const expenseId = uuidv7();
    await sql`INSERT INTO expenses (id, fund_id, status, expense_data, created_at, updated_at)
      VALUES (${expenseId}, ${fundId}, 'paid', ${sql.json({ bankTransactionId: debitId, amountPaise: 500 })}, now(), now())`;
    const common = {
      fund_id: fundId,
      version: 1 as const,
      actor: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
      occurred_at: "2026-10-28T02:00:00.000Z",
    };
    await appendEvent(sql, {
      ...common,
      type: "donation.verified",
      payload: payloadSchemas["donation.verified"].parse({
        donation_id: pledgeId,
        bank_transaction_id: creditId,
      }),
    });
    await appendEvent(sql, {
      ...common,
      type: "bank.debit_seen",
      payload: payloadSchemas["bank.debit_seen"].parse({
        bank_transaction_id: debitId,
        amount_paise: 500,
      }),
    });
    expect(await store().anchoredItems(fundId)).toEqual(new Set());
    const anchorId = uuidv7();
    await sql`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, status, chain_id, chain_sequence)
      VALUES (${anchorId}, ${fundId}, 1, 2, ${"a".repeat(64)}, 'pending', 80002, 1)`;
    expect(await store().anchoredItems(fundId)).toEqual(new Set());
    await sql`UPDATE anchors SET status = 'submitted', tx_hash = ${`0x${"b".repeat(64)}`} WHERE id = ${anchorId}`;
    expect(await store().anchoredItems(fundId)).toEqual(new Set());
    await sql`UPDATE anchors SET status = 'confirmed', confirmed_at = now() WHERE id = ${anchorId}`;
    expect(await store().anchoredItems(fundId)).toEqual(new Set([creditId]));
    await sql`UPDATE expenses SET status = 'reconciled' WHERE id = ${expenseId}`;
    expect(await store().anchoredItems(fundId)).toEqual(new Set([creditId, expenseId]));
    await sql`UPDATE bank_transactions SET reconciliation_status = 'unmatched' WHERE id = ${creditId}`;
    expect(await store().anchoredItems(fundId)).toEqual(new Set([expenseId]));
    expect(await store().anchoredItems(await fund())).toEqual(new Set());
  });

  it("returns an empty list for a fund with no bank-matched donations", async () => {
    expect(await store().donations(uuidv7())).toEqual([]);
  });
});
