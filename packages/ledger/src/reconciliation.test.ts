import { uuidv7 } from "@yen/db";
import { paise } from "@yen/shared";
import { expect, it } from "vitest";
import { getFundEvents } from "./eventlog.js";
import { available, getBalances, pledgeDonation, reconcilePledge } from "./operations.js";
import { replayFundEvents } from "./replay.js";
import { ledgerDatabaseSuite } from "./test/database.js";

ledgerDatabaseSuite("pledge reconciliation", (sql) => {
  it("promotes pledge to verified and moves money into spendable bank balance", async () => {
    const fundId = uuidv7();
    const bankTxId = uuidv7();
    const utr = "123456789012";

    // 1. Ingest bank transaction into bank_transactions
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${bankTxId}, ${fundId}, 'BANK_REF_001', ${utr}, 50000, 'credit',
        '2026-10-28T10:00:00Z', 'statement_upload', '{}'::jsonb
      )
    `;

    // 2. Donor self-reports pledge
    const pledgeRes = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId, amount: paise(50000), utr }),
    );
    if (pledgeRes.kind !== "pledged") throw new Error("pledge failed");

    // Before reconciliation: spendable balance is 0, pledged is 50000
    const beforeBalances = await getBalances(sql, fundId);
    expect(beforeBalances.bankPaise).toBe(0n);
    expect(beforeBalances.availablePaise).toBe(0n);
    expect(beforeBalances.pledgedPaise).toBe(50000n);
    expect(beforeBalances.donationsPaise).toBe(0n);

    // 3. Reconcile pledge with bank transaction
    const reconRes = await sql.begin((tx) =>
      reconcilePledge(tx, {
        fundId,
        pledgeId: pledgeRes.donationId,
        bankTransactionId: bankTxId,
        matchMethod: "exact_utr",
        matchConfidence: 1.0,
      }),
    );
    expect(reconRes.kind).toBe("reconciled");

    // After reconciliation: bank and donations have 50000, pledged is 0
    const afterBalances = await getBalances(sql, fundId);
    expect(afterBalances.bankPaise).toBe(50000n);
    expect(afterBalances.availablePaise).toBe(50000n);
    expect(afterBalances.pledgedPaise).toBe(0n);
    expect(afterBalances.donationsPaise).toBe(50000n);
    expect(await available(sql, fundId)).toBe(50000n);

    // Verify donation_pledges row was updated to verified
    const [pledgeRow] = await sql<{ status: string; verified_at: Date | null }[]>`
      SELECT status, verified_at FROM donation_pledges WHERE id = ${pledgeRes.donationId}
    `;
    expect(pledgeRow?.status).toBe("verified");
    expect(pledgeRow?.verified_at).not.toBeNull();

    // Verify bank_transactions row was updated to matched
    const [txRow] = await sql<
      {
        reconciliation_status: string;
        matched_pledge_id: string;
        match_method: string;
        match_confidence: string;
      }[]
    >`
      SELECT reconciliation_status, matched_pledge_id, match_method, match_confidence::text
      FROM bank_transactions WHERE id = ${bankTxId}
    `;
    expect(txRow?.reconciliation_status).toBe("matched");
    expect(txRow?.matched_pledge_id).toBe(pledgeRes.donationId);
    expect(txRow?.match_method).toBe("exact_utr");
    expect(txRow?.match_confidence).toBe("1.00");

    // Verify event log and replay consistency
    const events = await getFundEvents(sql, fundId);
    expect(events.map((e) => e.type)).toEqual(["donation.pledged", "donation.verified"]);
    expect(events[1]?.payload).toEqual({
      donation_id: pledgeRes.donationId,
      bank_transaction_id: bankTxId,
    });

    const replayed = replayFundEvents(fundId, events);
    expect(replayed).toEqual(afterBalances);
  });

  it("is idempotent when replaying reconciliation", async () => {
    const fundId = uuidv7();
    const bankTxId = uuidv7();
    const utr = "987654321098";

    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${bankTxId}, ${fundId}, 'BANK_REF_DUP', ${utr}, 25000, 'credit',
        '2026-10-28T10:00:00Z', 'webhook_partner', '{}'::jsonb
      )
    `;

    const pledgeRes = await sql.begin((tx) =>
      pledgeDonation(tx, { fundId, amount: paise(25000), utr }),
    );
    if (pledgeRes.kind !== "pledged") throw new Error("pledge failed");

    // First reconciliation
    const first = await sql.begin((tx) =>
      reconcilePledge(tx, {
        fundId,
        pledgeId: pledgeRes.donationId,
        bankTransactionId: bankTxId,
      }),
    );
    expect(first.kind).toBe("reconciled");
    if (first.kind === "reconciled") {
      expect(first.duplicate).toBeUndefined();
    }

    // Second reconciliation (replay)
    const second = await sql.begin((tx) =>
      reconcilePledge(tx, {
        fundId,
        pledgeId: pledgeRes.donationId,
        bankTransactionId: bankTxId,
      }),
    );
    expect(second.kind).toBe("reconciled");
    if (second.kind === "reconciled") {
      expect(second.duplicate).toBe(true);
    }

    // Balances remained untouched on replay
    const balances = await getBalances(sql, fundId);
    expect(balances.bankPaise).toBe(25000n);
    expect(balances.availablePaise).toBe(25000n);
    expect(balances.pledgedPaise).toBe(0n);
    expect(balances.donationsPaise).toBe(25000n);
  });

  it("rejects non-existent pledge", async () => {
    const fundId = uuidv7();
    const nonExistentPledgeId = uuidv7();
    const bankTxId = uuidv7();

    const res = await sql.begin((tx) =>
      reconcilePledge(tx, {
        fundId,
        pledgeId: nonExistentPledgeId,
        bankTransactionId: bankTxId,
      }),
    );
    expect(res).toEqual({ kind: "pledge_not_found" });
  });
});
