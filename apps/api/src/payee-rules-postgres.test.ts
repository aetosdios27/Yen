import { randomInt } from "node:crypto";
import { migrate, uuidv7 } from "@yen/db";
import { type PseudonymId, parsePseudonymId } from "@yen/eventlog";
import { createDraftRequest, type ExpenseRequest } from "@yen/ledger";
import { createUnverifiedPayee, type FraudFlag } from "@yen/policy";
import { paise } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { createApp } from "./app.js";
import { MemoryFundStore, type Principal } from "./dependencies.js";
import { PostgresExpenseStore } from "./expense-store.js";
import { PostgresPayeeProfileStore } from "./payee-rules/profile-store.js";
import { fingerprintPayee } from "./payee-rules/service.js";
import {
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  MemoryPinStore,
  PinService,
} from "./pin/index.js";
import { devPolicy, type FundRecord } from "./policy.js";

const PIN_SECRET = "p".repeat(40);
const FINGERPRINT_SALT = "f".repeat(40);

interface SeededFund {
  readonly fundId: string;
  readonly ownerUserId: string;
  readonly requesterUserId: string;
  readonly approverUserId: string;
  readonly ownerPseudonym: PseudonymId;
  readonly requesterPseudonym: PseudonymId;
  readonly approverPseudonym: PseudonymId;
  readonly record: FundRecord;
}

databaseSuite("Postgres payee profiles, fraud flags, and acknowledgements", (sql) => {
  let store: PostgresExpenseStore;
  let profileStore: PostgresPayeeProfileStore;

  beforeAll(async () => {
    await migrate(sql);
    store = new PostgresExpenseStore(sql);
    profileStore = new PostgresPayeeProfileStore(sql);
  });

  async function seedFund(): Promise<SeededFund> {
    const ownerUserId = uuidv7();
    const requesterUserId = uuidv7();
    const approverUserId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    const ownerPseudonym = parsePseudonymId(`psn_${uuidv7()}`);
    const requesterPseudonym = parsePseudonymId(`psn_${uuidv7()}`);
    const approverPseudonym = parsePseudonymId(`psn_${uuidv7()}`);
    const users = [ownerUserId, requesterUserId, approverUserId];
    for (const [index, userId] of users.entries()) {
      const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
      await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, ${`Member ${index}`})`;
    }
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Payee Test Org', 'society', ${ownerUserId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json, visibility_tier) VALUES (${fundId}, ${orgId}, 'Payee Test Fund', '{}'::jsonb, 'members')`;
    await sql`INSERT INTO memberships (fund_id, user_id, role, status) VALUES
      (${fundId}, ${ownerUserId}, 'owner', 'active'),
      (${fundId}, ${requesterUserId}, 'member', 'active'),
      (${fundId}, ${approverUserId}, 'approver', 'active')`;
    for (const [userId, pseudonym] of [
      [ownerUserId, ownerPseudonym],
      [requesterUserId, requesterPseudonym],
      [approverUserId, approverPseudonym],
    ] as const) {
      await sql`INSERT INTO fund_pseudonyms (pseudonym_id, user_id, fund_id) VALUES (${pseudonym.slice("psn_".length)}, ${userId}, ${fundId})`;
    }
    return {
      fundId,
      ownerUserId,
      requesterUserId,
      approverUserId,
      ownerPseudonym,
      requesterPseudonym,
      approverPseudonym,
      record: {
        owner: ownerUserId,
        fund: {
          name: "Payee Test Fund",
          purpose: "Postgres payee rules",
          targetPaise: "0",
          upiVpa: "fund@yenbank",
          upiPayeeName: "Payee Test Fund",
          visibility: "members",
          id: fundId,
          createdAt: new Date().toISOString(),
        },
      },
    };
  }

  it("persists a normalized salted fingerprint without storing the raw payee identity", async () => {
    const seeded = await seedFund();
    expect(await profileStore.getMemberDisplayName(seeded.fundId, seeded.requesterPseudonym)).toBe(
      "Member 1",
    );
    const payee = createUnverifiedPayee({
      identity: { kind: "upi", vpa: "  PrivateClub@YenBank " },
      name: "Private club account",
    });
    const fingerprint = fingerprintPayee(seeded.fundId, payee.identity, FINGERPRINT_SALT);
    await profileStore.set({
      fundId: seeded.fundId,
      memberPseudonym: seeded.requesterPseudonym,
      fingerprint,
      updatedAt: new Date().toISOString(),
    });
    expect(await profileStore.getFingerprint(seeded.fundId, seeded.requesterPseudonym)).toBe(
      fingerprint,
    );
    expect(await profileStore.listActiveFingerprints(seeded.fundId)).toEqual([fingerprint]);
    const stored = await sql`
      SELECT to_jsonb(profile) AS profile FROM member_payee_profiles profile
      WHERE fund_id = ${seeded.fundId} AND pseudonym_id = ${seeded.requesterPseudonym.slice("psn_".length)}
    `;
    const serialized = JSON.stringify(stored[0]?.profile);
    expect(serialized).toContain(fingerprint);
    expect(serialized).not.toContain("privateclub@yenbank");
    expect(serialized).not.toContain("PrivateClub@YenBank");
    expect(Object.keys(stored[0]?.profile as Record<string, unknown>).sort()).toEqual([
      "fingerprint",
      "fund_id",
      "pseudonym_id",
      "updated_at",
    ]);
    await profileStore.clear(seeded.fundId, seeded.requesterPseudonym);
    expect(await profileStore.getFingerprint(seeded.fundId, seeded.requesterPseudonym)).toBeNull();
  });

  it("persists fraud flags and an owner acknowledgement, then blocks API approval until acknowledged", async () => {
    const seeded = await seedFund();
    const payee = createUnverifiedPayee({
      identity: { kind: "upi", vpa: "requester@yenbank" },
      name: "Requester",
    });
    const payeeFingerprint = fingerprintPayee(seeded.fundId, payee.identity, FINGERPRINT_SALT);
    const now = new Date().toISOString();
    const draft = createDraftRequest({
      id: uuidv7(),
      fundId: seeded.fundId,
      requesterId: seeded.requesterPseudonym,
      amountPaise: paise(150_000),
      description: "Self-payment request",
      recipientRef: "requester@yenbank",
      createdAt: now,
    });
    const flag: FraudFlag = {
      code: "self_payment",
      reason: "Payee fingerprint matches the requester's active member profile.",
    };
    const expense: ExpenseRequest = {
      ...draft,
      payee,
      payeeFingerprint,
      fraudEvaluationId: uuidv7(),
      fraudFlags: [flag],
      status: "submitted",
      holdId: uuidv7(),
      submittedAt: now,
      updatedAt: now,
    };
    await store.save(draft);
    await sql`UPDATE expenses SET status = 'submitted', hold_id = ${expense.holdId},
      expense_data = ${JSON.stringify(expense)}::jsonb WHERE id = ${expense.id}`;
    await store.save(expense);
    expect(
      await sql`SELECT code, reason FROM expense_payee_flags WHERE evaluation_id = ${expense.fraudEvaluationId}`,
    ).toEqual([{ code: flag.code, reason: flag.reason }]);

    const fundStore = new MemoryFundStore();
    fundStore.set(seeded.fundId, seeded.record);
    const pinStore = new MemoryPinStore();
    const actionTokenStore = new MemoryActionTokenStore();
    const pinNotificationService = new MemoryPinNotificationService();
    const pinService = new PinService({
      pinStore,
      actionTokenStore,
      notificationService: pinNotificationService,
      pinSecret: PIN_SECRET,
      otpVerifier: null,
    });
    await pinService.setupPin(seeded.ownerUserId, "482915", { userId: seeded.ownerUserId });
    await pinService.setupPin(seeded.approverUserId, "593826", { userId: seeded.approverUserId });
    const actors = new Map<string, PseudonymId>([
      [seeded.ownerUserId, seeded.ownerPseudonym],
      [seeded.requesterUserId, seeded.requesterPseudonym],
      [seeded.approverUserId, seeded.approverPseudonym],
    ]);
    const appFor = (principal: Principal) =>
      createApp({
        principal,
        policy: devPolicy,
        fundStore,
        expenseStore: store,
        payeeProfileStore: profileStore,
        payeeFingerprintSalt: FINGERPRINT_SALT,
        actorForUser: async (userId) => {
          const pseudonym = actors.get(userId);
          if (!pseudonym) throw new Error("Missing seeded fund pseudonym");
          return pseudonym;
        },
        pinStore,
        actionTokenStore,
        pinNotificationService,
        pinSecret: PIN_SECRET,
        pinService,
      });
    const basePath = `/v1/funds/${seeded.fundId}/expenses/${expense.id}`;
    const approverApp = appFor({ id: seeded.approverUserId, role: "approver" });
    const approvalView = await approverApp.request(basePath);
    expect(approvalView.status).toBe(200);
    expect(
      ((await approvalView.json()) as { readonly fraudFlags: readonly FraudFlag[] }).fraudFlags,
    ).toContainEqual(flag);
    const blocked = await approverApp.request(`${basePath}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "blocked-before-owner-ack",
      },
      body: JSON.stringify({ pin: "593826" }),
    });
    expect(blocked.status).toBe(409);
    expect((await store.get(expense.id))?.approvals).toHaveLength(0);

    const ownerApp = appFor({ id: seeded.ownerUserId, role: "owner" });
    const acknowledged = await ownerApp.request(`${basePath}/fraud-acknowledgements`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "owner-self-payment-ack",
        "x-approval-pin": "482915",
      },
      body: JSON.stringify({
        code: "self_payment",
        reason: "I reviewed the member profile match and approve this expense.",
      }),
    });
    expect(acknowledged.status).toBe(200);
    const duplicateAcknowledgement = await ownerApp.request(`${basePath}/fraud-acknowledgements`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "owner-self-payment-ack-duplicate",
        "x-approval-pin": "482915",
      },
      body: JSON.stringify({
        code: "self_payment",
        reason: "This second reason must not replace the first audit row.",
      }),
    });
    expect(duplicateAcknowledgement.status).toBe(409);
    const ackRows = await sql`
      SELECT actor_pseudonym_id::text AS actor, reason FROM expense_payee_acknowledgements
      WHERE evaluation_id = ${expense.fraudEvaluationId} AND code = 'self_payment'
    `;
    expect(ackRows).toEqual([
      {
        actor: seeded.ownerPseudonym.slice("psn_".length),
        reason: "I reviewed the member profile match and approve this expense.",
      },
    ]);

    const approved = await approverApp.request(`${basePath}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "approval-after-owner-ack",
      },
      body: JSON.stringify({ pin: "593826" }),
    });
    expect(approved.status).toBe(200);
    expect((await store.get(expense.id))?.approvals).toHaveLength(1);
  });
});
