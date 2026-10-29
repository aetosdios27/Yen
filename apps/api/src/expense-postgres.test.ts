import { randomBytes, randomInt } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
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
import { createApp } from "./app.js";
import { fundSchema } from "./contract.js";
import { MemoryFundStore } from "./dependencies.js";
import { PostgresDonationPledgeStore } from "./donation-store.js";
import { PostgresExpenseObjectionStore } from "./expense-objections.js";
import { PostgresExpenseStore } from "./expense-store.js";
import {
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  MemoryPinStore,
  PinService,
} from "./pin/index.js";
import { devPolicy } from "./policy.js";
import { withMoneyOperation, withSpan } from "./telemetry.js";

const QUORUM_TWO = { approvalQuorum: 2, objectionWindowHours: 0, autoExpireHours: 0 } as const;
const verified = () => true;
const spanExporter = new InMemorySpanExporter();
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});

databaseSuite("Postgres expense store", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;

  beforeAll(async () => {
    trace.disable();
    tracerProvider.register();
    await migrate(sql);
    await initLedgerSchema(sql);
    secondSql = createSql(url);
  });

  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
    await tracerProvider.shutdown();
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

  it("serializes objections against approval and resolves uphold/dismiss outcomes", async () => {
    const fundId = await fund();
    const actorUserId = uuidv7();
    const startAt = Date.now() + 10_000;
    const at = (hours: number) => new Date(startAt + hours * 3_600_000).toISOString();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${actorUserId}, ${phone}, 'Objector')`;
    const { recordDonation, SYSTEM_ACTOR } = await import("@yen/ledger");
    await sql.begin((tx) =>
      recordDonation(tx, { fundId, amount: paise(5000), actorPseudonym: SYSTEM_ACTOR }),
    );
    const expenseStore = new PostgresExpenseStore(sql);
    const objectionStore = new PostgresExpenseObjectionStore(sql);
    const policy = { approvalQuorum: 1, objectionWindowHours: 24, autoExpireHours: 72 } as const;
    const expense = draft(fundId);
    await expenseStore.save(expense);
    const submitted = await expenseStore.save(
      {
        ...expense,
        status: "submitted",
        holdId: uuidv7(),
        submittedAt: at(0),
      },
      { policy },
    );
    if (!submitted?.holdId) throw new Error("Submitted expense did not create a hold");

    await expect(
      objectionStore.raise({
        expenseId: expense.id,
        actorUserId,
        reason: "Please call me at +919876543210",
        idempotencyKey: "raise-pii",
        nowUtc: at(1),
      }),
    ).rejects.toThrow("Invalid objection input");
    await expect(
      objectionStore.raise({
        expenseId: expense.id,
        actorUserId,
        reason: "x".repeat(501),
        idempotencyKey: "raise-too-long",
        nowUtc: at(1),
      }),
    ).rejects.toThrow("Invalid objection input");

    const raised = await objectionStore.raise({
      expenseId: expense.id,
      actorUserId,
      reason: "Please clarify the expense purpose",
      idempotencyKey: "raise-window-1",
      nowUtc: at(1),
    });
    expect(raised.duplicate).toBe(false);
    const appFor = (role: "donor" | "member" | null) =>
      createApp({
        principal: role ? { id: actorUserId, role } : null,
        policy: devPolicy,
        expenseStore,
        objectionStore,
        logger: { log: () => undefined },
      });
    const objectionPath = `/v1/funds/${fundId}/public/expenses/${expense.id}/objections`;
    const memberApp = appFor("member");
    const raiseRequest = () =>
      memberApp.request(`/v1/funds/${fundId}/expenses/${expense.id}/objections`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-objection-idempotency",
        },
        body: JSON.stringify({ reason: "Please clarify the expense purpose" }),
      });
    expect((await raiseRequest()).status).toBe(201);
    const replay = await raiseRequest();
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");

    const publicResponse = await appFor(null).request(objectionPath);
    expect(await publicResponse.json()).toEqual({ count: 1, openCount: 1 });
    const donorResponse = await appFor("donor").request(objectionPath);
    const donorBody = (await donorResponse.json()) as {
      objections: Array<Record<string, unknown>>;
    };
    expect(donorBody.objections[0]).not.toHaveProperty("reason");
    const memberResponse = await memberApp.request(objectionPath);
    const memberBody = (await memberResponse.json()) as {
      objections: Array<Record<string, unknown>>;
    };
    expect(memberBody.objections[0]?.reason).toBe("Please clarify the expense purpose");

    const approval = {
      approverId: `psn_${uuidv7()}` as PseudonymId,
      passkeySignature: {
        credentialId: "pin",
        signatureHex: "00",
        clientDataJson: "{}",
        authenticatorDataHex: "00",
      },
      approvedAt: at(25),
    };
    const approvalResult = await expenseStore.atomicApprove(
      expense.id,
      approval,
      policy,
      verified,
      approval.approvedAt,
    );
    expect(approvalResult.reachedQuorum).toBe(false);
    expect(approvalResult.expense.status).toBe("submitted");

    const rejected = await objectionStore.resolve({
      expenseId: expense.id,
      objectionId: raised.id,
      actorUserId,
      resolution: "upheld",
      reason: "The request is outside the fund purpose",
      policy,
      nowUtc: at(26),
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("objection");
    expect(await sql`SELECT status FROM konto_holds WHERE id = ${submitted.holdId}`).toEqual([
      { status: "ROLLED_BACK" },
    ]);

    const dismissedDraft = draft(fundId);
    await expenseStore.save(dismissedDraft);
    const dismissedSubmitted = await expenseStore.save(
      {
        ...dismissedDraft,
        status: "submitted",
        holdId: uuidv7(),
        submittedAt: at(27),
      },
      { policy },
    );
    if (!dismissedSubmitted?.holdId) throw new Error("Submitted expense did not create a hold");
    const dismissedObjection = await objectionStore.raise({
      expenseId: dismissedDraft.id,
      actorUserId,
      reason: "I need the supporting receipt",
      idempotencyKey: "raise-window-dismissed",
      nowUtc: at(28),
    });
    const dismissedApproval = await expenseStore.atomicApprove(
      dismissedDraft.id,
      { ...approval, approverId: `psn_${uuidv7()}` as PseudonymId },
      policy,
      verified,
      at(52),
    );
    expect(dismissedApproval.expense.status).toBe("submitted");
    const continued = await objectionStore.resolve({
      expenseId: dismissedDraft.id,
      objectionId: dismissedObjection.id,
      actorUserId,
      resolution: "dismissed",
      reason: "Receipt review completed",
      policy,
      nowUtc: at(53),
    });
    expect(continued.status).toBe("approved");
    expect(
      await sql`SELECT status FROM konto_holds WHERE id = ${dismissedSubmitted.holdId}`,
    ).toEqual([{ status: "PENDING" }]);

    const raceDraft = draft(fundId);
    await expenseStore.save(raceDraft);
    await expenseStore.save(
      { ...raceDraft, status: "submitted", holdId: uuidv7(), submittedAt: at(54) },
      { policy },
    );
    const race = await Promise.allSettled([
      objectionStore.raise({
        expenseId: raceDraft.id,
        actorUserId,
        reason: "Need an additional purpose explanation",
        idempotencyKey: "raise-window-race",
        nowUtc: at(55),
      }),
      expenseStore.atomicApprove(
        raceDraft.id,
        { ...approval, approverId: `psn_${uuidv7()}` as PseudonymId, approvedAt: at(80) },
        policy,
        verified,
        at(80),
      ),
    ]);
    const racedExpense = await expenseStore.get(raceDraft.id);
    expect(race[1]?.status).toBe("fulfilled");
    expect(racedExpense?.status).toBe(race[0]?.status === "fulfilled" ? "submitted" : "approved");
    expect(race[0]?.status === "fulfilled" || racedExpense?.status === "approved").toBe(true);
    expect(
      await sql`SELECT seq FROM fund_events WHERE fund_id = ${fundId} AND type = 'expense.objection_raised' AND version = 2`,
    ).toHaveLength(2 + (race[0]?.status === "fulfilled" ? 1 : 0));
  });

  it("does not let a donor object to an expense through another fund URL", async () => {
    const actualFundId = await fund();
    const otherFundId = await fund();
    const donorId = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${donorId}, ${phone}, 'Donor')`;
    const expenseStore = new PostgresExpenseStore(sql);
    const objectionStore = new PostgresExpenseObjectionStore(sql);
    const expense = draft(actualFundId);
    await expenseStore.save(expense);
    const app = createApp({
      principal: { id: donorId, role: "donor" },
      policy: devPolicy,
      expenseStore,
      objectionStore,
      logger: { log: () => undefined },
    });

    const response = await app.request(
      `/v1/funds/${otherFundId}/expenses/${expense.id}/objections`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "cross-fund-objection" },
        body: JSON.stringify({ reason: "Please explain this expense" }),
      },
    );
    expect(response.status).toBe(404);
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

  it("keeps journey actors fund-scoped and personal data out of API logs, event chains, and Merkle leaves", async () => {
    spanExporter.reset();
    const userIds: [string, string, string] = [uuidv7(), uuidv7(), uuidv7()];
    const userFixtures = [
      {
        id: userIds[0],
        phone: "+919111111111",
        name: "Journey Alice",
        email: "alice@example.test",
      },
      {
        id: userIds[1],
        phone: "+919222222222",
        name: "Journey Bhavna",
        email: "bhavna@example.test",
      },
      {
        id: userIds[2],
        phone: "+919333333333",
        name: "Journey Chandra",
        email: "chandra@example.test",
      },
    ];
    const donorFixture = userFixtures[1];
    if (!donorFixture) throw new Error("Journey donor fixture was missing");
    for (const fixture of userFixtures) {
      await sql`INSERT INTO users (id, phone, display_name) VALUES (${fixture.id}, ${fixture.phone}, ${fixture.name})`;
    }
    const logOutput: string[] = [];
    const logger = { log: (entry: unknown) => logOutput.push(JSON.stringify(entry)) };
    const fundStore = new MemoryFundStore();
    const fundOwnerApi = createApp({
      principal: { id: userIds[0] },
      fundStore,
      policy: devPolicy,
      logger,
    });
    const donorApi = createApp({
      principal: { id: userIds[1] },
      fundStore,
      policy: devPolicy,
      donationPledgeStore: new PostgresDonationPledgeStore(sql),
      logger,
    });
    const fundIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const orgId = uuidv7();
      const fundResponse = await fundOwnerApi.request("/v1/funds", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": `journey-fund-${index}` },
        body: JSON.stringify({
          name: "Journey Fund",
          targetPaise: "5000000",
          upiVpa: "journey@yenbank",
          upiPayeeName: "Journey Club",
        }),
      });
      expect(fundResponse.status).toBe(201);
      const fund = fundSchema.parse(await fundResponse.json());
      const fundId = fund.id;
      await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Journey Org', 'society', ${userIds[0]})`;
      await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, ${fund.name}, '{}'::jsonb)`;
      fundIds.push(fundId);
    }

    const expenseStore = new PostgresExpenseStore(sql);
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
      const pledgeResponse = await donorApi.request(`/v1/funds/${fundId}/donations/pledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `journey-pledge-${fundIndex}`,
        },
        body: JSON.stringify({
          amountPaise: "1000",
          utr: `1234567890${fundIndex}1`,
          donorName: donorFixture.name,
          donorNameChoice: "full",
          donorContact: donorFixture.email,
        }),
      });
      expect(pledgeResponse.status).toBe(201);
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
        await withMoneyOperation("approve", () =>
          withSpan("db.expense.atomic_approve", () =>
            expenseStore.atomicApprove(
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
            ),
          ),
        );
      }
      const approved = await expenseStore.get(draftExpense.id);
      if (!approved) throw new Error("Expense disappeared during journey");
      await expect(
        expenseStore.save(payExpense(approved, uuidv7(), new Date(Date.now() + 9).toISOString()), {
          actorUserId: userIds[0],
          policy: QUORUM_TWO,
        }),
      ).rejects.toThrow("unmatched ingested debit");
      const bankTransactionId = uuidv7();
      await sql`
        INSERT INTO bank_transactions (
          id, fund_id, bank_reference, amount_paise, type, posted_at, source, raw_payload
        ) VALUES (
          ${bankTransactionId}, ${fundId}, ${`journey-${fundIndex}`}, '5000', 'debit',
          ${now}, 'statement_upload', '{}'::jsonb
        )
      `;
      await withMoneyOperation("pay", () =>
        withSpan("db.expense.save", () =>
          expenseStore.save(
            payExpense(approved, bankTransactionId, new Date(Date.now() + 10).toISOString()),
            { actorUserId: userIds[0], policy: QUORUM_TWO },
          ),
        ),
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
        ...userFixtures.map((fixture) => fixture.email),
      ]) {
        expect(serialized).not.toContain(personalValue);
      }
      const serializedLogs = logOutput.join(" ");
      for (const personalValue of [
        ...userIds,
        ...userFixtures.map((fixture) => fixture.phone),
        ...userFixtures.map((fixture) => fixture.name),
        ...userFixtures.map((fixture) => fixture.email),
      ]) {
        expect(serializedLogs).not.toContain(personalValue);
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
        ...userFixtures.map((fixture) => fixture.email),
      ]) {
        expect(serializedLeaves).not.toContain(personalValue);
      }
      everyActor.push(events.map((event) => event.actor));
    }
    expect(everyActor[0]).toBeDefined();
    expect(everyActor[1]).toBeDefined();
    const spans = spanExporter.getFinishedSpans();
    expect(spans.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "money.approve",
        "db.expense.atomic_approve",
        "ledger.approve",
        "event.append",
        "money.pay",
        "db.expense.save",
      ]),
    );
    const personalValues = [
      ...userIds,
      "+919111111111",
      "+919222222222",
      "+919333333333",
      "Journey Alice",
      "Journey Bhavna",
      "Journey Chandra",
    ];
    for (const { attributes } of spans) {
      for (const [key, value] of Object.entries(attributes)) {
        expect(key).not.toMatch(/user.?id|phone|name|upi|amount/i);
        for (const personalValue of personalValues) {
          expect(JSON.stringify(value)).not.toContain(personalValue);
        }
      }
    }
    expect(everyActor[0]?.filter((actor) => everyActor[1]?.includes(actor))).toEqual([]);
  });

  it("blocks approval while a fraud flag is unacknowledged and while an objection is open", async () => {
    const fundId = await fund();
    const actorUserId = uuidv7();
    const startAt = Date.now() + 10_000;
    const at = (hours: number) => new Date(startAt + hours * 3_600_000).toISOString();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${actorUserId}, ${phone}, 'Flagged Objector')`;
    const { recordDonation, SYSTEM_ACTOR, UnacknowledgedFraudFlagsError } = await import(
      "@yen/ledger"
    );
    await sql.begin((tx) =>
      recordDonation(tx, { fundId, amount: paise(5000), actorPseudonym: SYSTEM_ACTOR }),
    );
    const expenseStore = new PostgresExpenseStore(sql);
    const objectionStore = new PostgresExpenseObjectionStore(sql);
    const policy = { approvalQuorum: 1, objectionWindowHours: 24, autoExpireHours: 72 } as const;
    const expense = draft(fundId);
    await expenseStore.save(expense);
    const flag = { code: "self_payment" as const, reason: "Payee matches the requester" };
    const submitted = await expenseStore.save(
      { ...expense, status: "submitted", holdId: uuidv7(), submittedAt: at(0), fraudFlags: [flag] },
      { policy },
    );
    if (!submitted?.holdId) throw new Error("Submitted expense did not create a hold");
    await objectionStore.raise({
      expenseId: expense.id,
      actorUserId,
      reason: "Please clarify the payee",
      idempotencyKey: "raise-fraud-and-objection",
      nowUtc: at(1),
    });
    const approverApproval = (approvedAt: string) => ({
      approverId: `psn_${uuidv7()}` as PseudonymId,
      passkeySignature: {
        credentialId: "pin",
        signatureHex: "00",
        clientDataJson: "{}",
        authenticatorDataHex: "00",
      },
      approvedAt,
    });

    // Fraud flag unacknowledged and objection open: approval is rejected by the fraud gate.
    await expect(
      expenseStore.atomicApprove(expense.id, approverApproval(at(30)), policy, verified, at(30)),
    ).rejects.toThrow(UnacknowledgedFraudFlagsError);

    // Owner acknowledges the flag; the open objection still blocks quorum after its window closed.
    const current = await expenseStore.get(expense.id);
    if (!current) throw new Error("Expense not found");
    await expenseStore.save(
      {
        ...current,
        fraudAcknowledgements: [
          {
            code: "self_payment",
            actorPseudonym: `psn_${uuidv7()}` as PseudonymId,
            reason: "Reviewed with the requester",
            acknowledgedAt: at(2),
          },
        ],
      },
      { policy },
    );
    const blocked = await expenseStore.atomicApprove(
      expense.id,
      approverApproval(at(30)),
      policy,
      verified,
      at(30),
    );
    expect(blocked.reachedQuorum).toBe(false);
    expect(blocked.expense.status).toBe("submitted");
  });

  it("traces API approval and payment on Postgres without personal span attributes", async () => {
    spanExporter.reset();
    const ownerId = uuidv7();
    const approverIds = [uuidv7(), uuidv7()] as const;
    const personalFixtures = [
      { id: ownerId, phone: "+919111112222", name: "Trace Journey Owner" },
      { id: approverIds[0], phone: "+919222223333", name: "Trace Journey Approver One" },
      { id: approverIds[1], phone: "+919333334444", name: "Trace Journey Approver Two" },
    ];
    for (const fixture of personalFixtures) {
      await sql`INSERT INTO users (id, phone, display_name) VALUES (${fixture.id}, ${fixture.phone}, ${fixture.name})`;
    }
    const orgId = uuidv7();
    const fundId = uuidv7();
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Trace Journey Org', 'society', ${ownerId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Trace Journey Fund', '{}'::jsonb)`;
    await sql.begin((tx) =>
      recordDonation(tx, {
        fundId,
        amount: paise(100_000),
        actorPseudonym: `psn_${uuidv7()}` as PseudonymId,
      }),
    );

    const expenseStore = new PostgresExpenseStore(sql);
    const pinStore = new MemoryPinStore();
    const actionTokenStore = new MemoryActionTokenStore();
    const pinNotificationService = new MemoryPinNotificationService();
    const pinService = new PinService({
      pinStore,
      actionTokenStore,
      notificationService: pinNotificationService,
      pinSecret: randomBytes(32).toString("hex"),
    });
    // The default fund objection window is 24h; approvals only reach quorum after it closes.
    let nowMs = Date.now();
    const makeApp = (principal: { id: string; role: "owner" | "approver" }) =>
      createApp({
        principal,
        policy: devPolicy,
        expenseStore,
        pinStore,
        actionTokenStore,
        pinNotificationService,
        pinService,
        clock: () => nowMs,
        logger: { log: () => undefined },
      });
    const ownerApp = makeApp({ id: ownerId, role: "owner" });
    const createResponse = await ownerApp.request(`/v1/funds/${fundId}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "trace-create" },
      body: JSON.stringify({
        amountPaise: "5000",
        description: "Traceable supplies",
        recipientRef: "trace-supplier",
        payee: {
          identity: { kind: "upi", vpa: "trace-supplier@yenbank" },
          name: "Trace Supplier",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string; status: string };
    expect(created.status).toBe("draft");

    const submitResponse = await ownerApp.request(
      `/v1/funds/${fundId}/expenses/${created.id}/submit`,
      { method: "POST", headers: { "idempotency-key": "trace-submit" } },
    );
    expect(submitResponse.status).toBe(200);
    nowMs += 25 * 3_600_000;

    for (const approverId of approverIds) {
      await pinService.setupPin(approverId, "482915", { userId: approverId });
      const response = await makeApp({ id: approverId, role: "approver" }).request(
        `/v1/funds/${fundId}/expenses/${created.id}/approve`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `trace-approve-${approverId}`,
          },
          body: JSON.stringify({ pin: "482915" }),
        },
      );
      expect(response.status).toBe(200);
    }

    const traceBankTransactionId = uuidv7();
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, amount_paise, type, posted_at, source, raw_payload
      ) VALUES (
        ${traceBankTransactionId}, ${fundId}, ${`trace-${traceBankTransactionId}`}, '5000', 'debit',
        ${new Date().toISOString()}, 'statement_upload', '{}'::jsonb
      )
    `;
    const payResponse = await ownerApp.request(`/v1/funds/${fundId}/expenses/${created.id}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "trace-pay" },
      body: JSON.stringify({ bankTransactionId: traceBankTransactionId }),
    });
    expect(payResponse.status).toBe(200);
    expect((await expenseStore.get(created.id))?.status).toBe("paid");

    await tracerProvider.forceFlush();
    const spans = spanExporter.getFinishedSpans();
    expect(spans.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "POST /v1/funds/:fundId/expenses",
        "POST /v1/funds/:fundId/expenses/:expenseId/submit",
        "POST /v1/funds/:fundId/expenses/:expenseId/approve",
        "POST /v1/funds/:fundId/expenses/:expenseId/pay",
        "pin.verify",
        "money.approve",
        "db.expense.atomic_approve",
        "ledger.approve",
        "event.append",
        "notification.enqueue",
        "money.pay",
        "ledger.pay",
        "db.expense.save",
      ]),
    );
    const personalValues = [
      ...personalFixtures.flatMap(({ id, phone, name }) => [id, phone, name]),
      "5000",
      "482915",
      fundId,
      created.id,
    ];
    for (const { attributes } of spans) {
      for (const [key, value] of Object.entries(attributes)) {
        expect(key).not.toMatch(/user.?id|phone|name|upi|amount/i);
        for (const personalValue of personalValues) {
          expect(JSON.stringify(value)).not.toContain(personalValue);
        }
      }
    }
  });
});
