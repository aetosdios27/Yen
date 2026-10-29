import { randomInt } from "node:crypto";
import { createSql, migrate, uuidv7 } from "@yen/db";
import { createDraftRequest, type PseudonymId } from "@yen/ledger";
import { paise } from "@yen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { PostgresExpenseStore } from "./expense-store.js";

const QUORUM_TWO = { approvalQuorum: 2, objectionWindowHours: 0, autoExpireHours: 0 } as const;
const verified = () => true;

databaseSuite("Postgres expense store", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;

  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
    secondSql = createSql(url);
  });

  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
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

  function draft(fundId: string) {
    return createDraftRequest({
      id: uuidv7(),
      fundId,
      requesterId: `psn_${uuidv7()}` as PseudonymId,
      amountPaise: paise(500),
      description: "Test supplies",
      recipientRef: "supplier-1",
      createdAt: new Date().toISOString(),
    });
  }

  it("survives construction of a new API store instance", async () => {
    const expense = draft(await fund());
    await new PostgresExpenseStore(sql).save(expense);
    expect(await new PostgresExpenseStore(secondSql).get(expense.id)).toEqual(expense);
  });

  it("serializes approvals across separate store instances and emits quorum once", async () => {
    const fundId = await fund();
    const expense = {
      ...draft(fundId),
      status: "submitted" as const,
      holdId: uuidv7(),
      submittedAt: new Date(Date.now() - 1000).toISOString(),
    };
    const first = new PostgresExpenseStore(sql);
    const second = new PostgresExpenseStore(secondSql);
    await first.save({ ...expense, status: "draft", holdId: null, submittedAt: null });
    await sql`
      UPDATE expenses SET status = 'submitted', hold_id = ${expense.holdId},
        expense_data = ${JSON.stringify(expense)}::jsonb WHERE id = ${expense.id}
    `;
    const now = new Date().toISOString();
    const [a, b] = await Promise.all([
      first.atomicApprove(
        expense.id,
        {
          approverId: `psn_${uuidv7()}` as PseudonymId,
          passkeySignature: {
            credentialId: "pin",
            signatureHex: "00",
            clientDataJson: "{}",
            authenticatorDataHex: "00",
          },
          approvedAt: now,
        },
        QUORUM_TWO,
        verified,
        now,
      ),
      second.atomicApprove(
        expense.id,
        {
          approverId: `psn_${uuidv7()}` as PseudonymId,
          passkeySignature: {
            credentialId: "pin",
            signatureHex: "00",
            clientDataJson: "{}",
            authenticatorDataHex: "00",
          },
          approvedAt: now,
        },
        QUORUM_TWO,
        verified,
        now,
      ),
    ]);
    expect([a.reachedQuorum, b.reachedQuorum].filter(Boolean)).toHaveLength(1);
    expect((await first.get(expense.id))?.status).toBe("approved");
    const events =
      await sql`SELECT seq FROM fund_events WHERE fund_id = ${fundId} AND type = 'expense.approved'`;
    expect(events).toHaveLength(1);
    expect(
      await sql`SELECT approver_id FROM expense_approvals WHERE expense_id = ${expense.id}`,
    ).toHaveLength(2);
    await expect(
      sql`UPDATE expense_approvals SET approved_at = ${now} WHERE expense_id = ${expense.id}`,
    ).rejects.toThrow("expense_approvals is append-only: UPDATE is forbidden");
  });

  it("rolls back a hold when expense persistence fails after the hold was made", async () => {
    const fundId = await fund();
    const { recordDonation, SYSTEM_ACTOR } = await import("@yen/ledger");
    await sql.begin((tx) =>
      recordDonation(tx, { fundId, amount: paise(5000), actorPseudonym: SYSTEM_ACTOR }),
    );
    const store = new PostgresExpenseStore(sql);
    const expense = draft(fundId);
    await store.save(expense);
    await sql.unsafe(`
      CREATE FUNCTION fail_expense_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected persistence failure'; END; $$;
      CREATE TRIGGER fail_expense_update BEFORE UPDATE ON expenses
      FOR EACH ROW EXECUTE FUNCTION fail_expense_update();
    `);
    try {
      const submitted = {
        ...expense,
        status: "submitted" as const,
        holdId: uuidv7(),
        submittedAt: new Date().toISOString(),
      };
      await expect(store.save(submitted, { policy: QUORUM_TWO })).rejects.toThrow(
        "injected persistence failure",
      );
      expect(
        await sql`SELECT id FROM konto_holds WHERE idempotency_key = ${`expense:${expense.id}:hold`}`,
      ).toHaveLength(0);
      expect((await store.get(expense.id))?.status).toBe("draft");
    } finally {
      await sql.unsafe(
        "DROP TRIGGER fail_expense_update ON expenses; DROP FUNCTION fail_expense_update()",
      );
    }
  });
});
