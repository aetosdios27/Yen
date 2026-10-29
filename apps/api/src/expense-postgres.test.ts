import { randomInt } from "node:crypto";
import { createSql, ensureFundPseudonym, getDisplayName, migrate, uuidv7 } from "@yen/db";
import { eventLeafHash, hashHexSchema } from "@yen/eventlog";
import {
  createDraftRequest,
  type PseudonymId,
  payExpense,
  recordDonation,
  submitExpense,
} from "@yen/ledger";
import { paise, salt32, toHex } from "@yen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { PostgresDonationPledgeStore } from "./donation-store.js";
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

  it("keeps every journey actor fund-scoped and personal data out of both event chains and leaves", async () => {
    const userIds: [string, string, string] = [uuidv7(), uuidv7(), uuidv7()];
    const userFixtures = [
      { id: userIds[0], phone: "+919111111111", name: "Journey Alice" },
      { id: userIds[1], phone: "+919222222222", name: "Journey Bhavna" },
      { id: userIds[2], phone: "+919333333333", name: "Journey Chandra" },
    ];
    for (const fixture of userFixtures) {
      await sql`INSERT INTO users (id, phone, display_name) VALUES (${fixture.id}, ${fixture.phone}, ${fixture.name})`;
    }
    const fundIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const orgId = uuidv7();
      const fundId = uuidv7();
      await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Journey Org', 'society', ${userIds[0]})`;
      await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Journey Fund', '{}'::jsonb)`;
      fundIds.push(fundId);
    }

    const expenseStore = new PostgresExpenseStore(sql);
    const donationStore = new PostgresDonationPledgeStore(sql);
    const everyActor: string[][] = [];
    for (const [fundIndex, fundId] of fundIds.entries()) {
      const [requester, approverOne, approverTwo] = await Promise.all(
        userIds.map((userId) => ensureFundPseudonym(sql, { userId, fundId })),
      );
      if (!requester || !approverOne || !approverTwo) {
        throw new Error("Journey fixtures were incomplete");
      }
      const donationActor = approverOne;
      await sql.begin(async (tx) => {
        const actorPseudonym = await ensureFundPseudonym(tx, {
          userId: userIds[1],
          fundId,
        });
        await recordDonation(tx, {
          fundId,
          amount: paise(100_000),
          actorPseudonym,
          donationId: uuidv7(),
          bankTransactionId: uuidv7(),
        });
      });
      await donationStore.pledge({
        fundId,
        amountPaise: 1000,
        utr: `1234567890${fundIndex}1`,
        actorPseudonym: donationActor,
        actorUserId: userIds[1],
        donorName: "Journey Bhavna",
        donorNameChoice: "full",
        donorContact: "+919222222222",
      });
      expect(await getDisplayName(sql, { fundId, pseudonymId: donationActor })).toBe(
        "Journey Bhavna",
      );

      const now = new Date().toISOString();
      const draftExpense = createDraftRequest({
        id: uuidv7(),
        fundId,
        requesterId: requester,
        amountPaise: paise(5000),
        description: "Supplies",
        recipientRef: "supplier",
        createdAt: now,
      });
      await expenseStore.save(draftExpense);
      const submitted = submitExpense(draftExpense, {
        holdId: uuidv7(),
        policy: QUORUM_TWO,
        nowUtc: now,
      });
      await expenseStore.save(submitted, { actorUserId: userIds[0], policy: QUORUM_TWO });
      for (const [approverIndex, approverId] of [approverOne, approverTwo].entries()) {
        await expenseStore.atomicApprove(
          draftExpense.id,
          {
            approverId,
            passkeySignature: {
              credentialId: "journey-test",
              signatureHex: "00",
              clientDataJson: "{}",
              authenticatorDataHex: "00",
            },
            approvedAt: new Date(Date.now() + approverIndex).toISOString(),
          },
          QUORUM_TWO,
          verified,
          new Date(Date.now() + approverIndex).toISOString(),
          userIds[approverIndex + 1],
        );
      }
      const approved = await expenseStore.get(draftExpense.id);
      if (!approved) throw new Error("Expense disappeared during journey");
      await expenseStore.save(
        payExpense(approved, uuidv7(), new Date(Date.now() + 10).toISOString()),
        { actorUserId: userIds[0], policy: QUORUM_TWO },
      );

      const events = await sql<
        { actor: string; payload: unknown; hash: string }[]
      >`SELECT actor, payload, hash FROM fund_events WHERE fund_id = ${fundId} ORDER BY seq`;
      expect(events.map((event) => event.actor)).toContain(requester);
      const serialized = JSON.stringify(events);
      for (const personalValue of [
        ...userIds,
        ...userFixtures.map((fixture) => fixture.phone),
        ...userFixtures.map((fixture) => fixture.name),
      ]) {
        expect(serialized).not.toContain(personalValue);
      }
      const leaves = await Promise.all(
        events.map(async (event) =>
          toHex(await eventLeafHash(salt32(new Uint8Array(32)), hashHexSchema.parse(event.hash))),
        ),
      );
      const serializedLeaves = JSON.stringify(leaves);
      for (const personalValue of [
        ...userIds,
        ...userFixtures.map((fixture) => fixture.phone),
        ...userFixtures.map((fixture) => fixture.name),
      ]) {
        expect(serializedLeaves).not.toContain(personalValue);
      }
      everyActor.push(events.map((event) => event.actor));
    }
    expect(everyActor[0]).toBeDefined();
    expect(everyActor[1]).toBeDefined();
    expect(everyActor[0]?.filter((actor) => everyActor[1]?.includes(actor))).toEqual([]);
  });
});
