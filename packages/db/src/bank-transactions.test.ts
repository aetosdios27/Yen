import { paise } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("bank_transactions table and immutability", (sql) => {
  const fundId = uuidv7();
  const pledgeId = uuidv7();

  beforeAll(async () => {
    await migrate(sql);
    // Seed prerequisite donation pledge for foreign key test
    await sql`
      INSERT INTO donation_pledges (id, fund_id, amount_paise, utr, status)
      VALUES (${pledgeId}, ${fundId}, 50000, '123456789012', 'pledged')
    `;
  });

  it("stores a credit bank transaction with raw payload preserved", async () => {
    const txId = uuidv7();
    const bankRef = "TXN_CR_001";
    const raw = { partner: "decentro", txn_id: "TXN_CR_001", amount: 500 };

    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        narration, counterparty_vpa, counterparty_name, source, raw_payload
      ) VALUES (
        ${txId}, ${fundId}, ${bankRef}, '123456789012', ${paise(50000).toString()}, 'credit',
        '2026-10-28T12:00:00Z', 'UPI/CR/123456789012/DONOR', 'donor@okhdfcbank', 'Asha Rao',
        'statement_upload', ${sql.json(raw)}
      )
    `;

    const [stored] = await sql<
      {
        id: string;
        fund_id: string;
        bank_reference: string;
        utr: string;
        amount_paise: string;
        type: string;
        reconciliation_status: string;
        raw_payload: typeof raw;
      }[]
    >`
      SELECT id, fund_id, bank_reference, utr, amount_paise::text, type, reconciliation_status, raw_payload
      FROM bank_transactions WHERE id = ${txId}
    `;

    expect(stored?.id).toBe(txId);
    expect(stored?.fund_id).toBe(fundId);
    expect(stored?.bank_reference).toBe(bankRef);
    expect(stored?.utr).toBe("123456789012");
    expect(stored?.amount_paise).toBe("50000");
    expect(stored?.type).toBe("credit");
    expect(stored?.reconciliation_status).toBe("unmatched");
    expect(stored?.raw_payload).toEqual(raw);
  });

  it("enforces uniqueness on (fund_id, bank_reference) for replay protection", async () => {
    const txId1 = uuidv7();
    const txId2 = uuidv7();
    const bankRef = "TXN_DUP_001";

    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${txId1}, ${fundId}, ${bankRef}, '999888777666', 25000, 'credit',
        '2026-10-28T12:00:00Z', 'webhook_partner', '{}'::jsonb
      )
    `;

    await expect(sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${txId2}, ${fundId}, ${bankRef}, '999888777666', 25000, 'credit',
        '2026-10-28T12:00:00Z', 'webhook_partner', '{}'::jsonb
      )
    `).rejects.toThrow(/bank_transactions_fund_reference_key/);
  });

  it("prohibits deleting rows from bank_transactions", async () => {
    const txId = uuidv7();
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${txId}, ${fundId}, 'TXN_DEL_001', '111222333444', 10000, 'credit',
        '2026-10-28T12:00:00Z', 'statement_upload', '{}'::jsonb
      )
    `;

    await expect(sql`DELETE FROM bank_transactions WHERE id = ${txId}`).rejects.toThrow(
      "bank_transactions rows are immutable and cannot be deleted",
    );
  });

  it("prohibits modifying financial fields of bank_transactions", async () => {
    const txId = uuidv7();
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${txId}, ${fundId}, 'TXN_IMMUTABLE_001', '555666777888', 15000, 'credit',
        '2026-10-28T12:00:00Z', 'statement_upload', '{}'::jsonb
      )
    `;

    // Attempt to tamper with amount
    await expect(sql`
      UPDATE bank_transactions SET amount_paise = 20000 WHERE id = ${txId}
    `).rejects.toThrow("bank_transactions financial attributes are immutable");

    // Attempt to tamper with bank_reference
    await expect(sql`
      UPDATE bank_transactions SET bank_reference = 'CHANGED' WHERE id = ${txId}
    `).rejects.toThrow("bank_transactions financial attributes are immutable");
  });

  it("allows updating reconciliation fields upon match", async () => {
    const txId = uuidv7();
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, utr, amount_paise, type, posted_at,
        source, raw_payload
      ) VALUES (
        ${txId}, ${fundId}, 'TXN_RECON_001', '123456789012', 50000, 'credit',
        '2026-10-28T12:00:00Z', 'statement_upload', '{}'::jsonb
      )
    `;

    const matchTime = new Date().toISOString();
    await sql`
      UPDATE bank_transactions
      SET
        reconciliation_status = 'matched',
        matched_pledge_id = ${pledgeId},
        matched_at = ${matchTime},
        match_confidence = 1.00,
        match_method = 'exact_utr'
      WHERE id = ${txId}
    `;

    const [updated] = await sql<
      {
        reconciliation_status: string;
        matched_pledge_id: string;
        match_confidence: string;
        match_method: string;
      }[]
    >`
      SELECT reconciliation_status, matched_pledge_id, match_confidence::text, match_method
      FROM bank_transactions WHERE id = ${txId}
    `;

    expect(updated?.reconciliation_status).toBe("matched");
    expect(updated?.matched_pledge_id).toBe(pledgeId);
    expect(updated?.match_confidence).toBe("1.00");
    expect(updated?.match_method).toBe("exact_utr");
  });
});
