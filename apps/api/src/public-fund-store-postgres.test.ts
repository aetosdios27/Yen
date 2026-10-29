import { randomInt } from "node:crypto";
import { migrate, uuidv7 } from "@yen/db";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { PostgresPublicFundReadStore } from "./public-fund-store.js";

let nextUtr = 100_000_000_000;

databaseSuite("Postgres public fund read store", (sql) => {
  const store = () => new PostgresPublicFundReadStore(sql);

  beforeAll(async () => {
    await migrate(sql);
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

  it("returns an empty list for a fund with no bank-matched donations", async () => {
    expect(await store().donations(uuidv7())).toEqual([]);
  });
});
