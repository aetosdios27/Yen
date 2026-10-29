import { randomInt } from "node:crypto";
import { createSql, ensureFundPseudonym, migrate, uuidv7 } from "@yen/db";
import { type ExpenseStore, type FundPolicy, InMemoryExpenseStore } from "@yen/ledger";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { createApp } from "./app.js";
import { PostgresFundStore } from "./fund-store.js";
import { devPolicy } from "./policy.js";

const createdAt = "2026-01-01T00:00:00.000Z";

databaseSuite("Postgres fund store", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;
  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
    secondSql = createSql(url);
  });
  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
  });

  async function owner(): Promise<string> {
    const id = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${id}, ${phone}, 'Owner')`;
    return id;
  }

  async function createFund() {
    const userId = await owner();
    const fundId = uuidv7();
    const record = {
      owner: userId,
      fund: {
        id: fundId,
        name: "Persistence test",
        targetPaise: "9000",
        upiVpa: "club@bank",
        upiPayeeName: "Club",
        visibility: "private" as const,
        version: 1,
        createdAt,
      },
    };
    await new PostgresFundStore(sql).create(fundId, record, userId);
    return { userId, fundId, record };
  }

  it("keeps funds, owner membership, pseudonym, ledger accounts, and event after store restart", async () => {
    const { userId, fundId, record } = await createFund();
    const restarted = new PostgresFundStore(secondSql);
    expect(await restarted.get(fundId)).toEqual(record);
    expect(await restarted.rolesFor(fundId, userId)).toEqual(["owner"]);
    expect(
      await sql`SELECT count(*)::int AS count FROM fund_events WHERE fund_id = ${fundId}`,
    ).toEqual([{ count: 1 }]);
    expect(
      await sql`SELECT count(*)::int AS count FROM fund_pseudonyms WHERE fund_id = ${fundId}`,
    ).toEqual([{ count: 1 }]);
    expect(
      await sql`SELECT count(*)::int AS count FROM konto_accounts WHERE name LIKE ${`fund:${fundId}:%`}`,
    ).toEqual([{ count: 6 }]);
    await new PostgresFundStore(sql).changePayee({
      fundId,
      actorUserId: userId,
      vpa: "newclub@bank",
      occurredAt: createdAt,
    });
    expect((await restarted.get(fundId))?.fund.upiVpa).toBe("newclub@bank");
  });

  it("commits visibility and v2 event together, and rolls both back on an injected failure", async () => {
    const { userId, fundId } = await createFund();
    const store = new PostgresFundStore(sql);
    await expect(
      new PostgresFundStore(sql, () => {
        throw new Error("injected failure");
      }).changeVisibility({
        fundId,
        ownerUserId: userId,
        visibility: "public",
        expectedVersion: 1,
        occurredAt: createdAt,
      }),
    ).rejects.toThrow("injected failure");
    expect((await store.get(fundId))?.fund.visibility).toBe("private");
    expect(
      await sql`SELECT count(*)::int AS count FROM fund_events WHERE fund_id = ${fundId}`,
    ).toEqual([{ count: 1 }]);
    const api = createApp({
      fundStore: store,
      principal: { id: userId, role: "member" },
      policy: devPolicy,
    });
    const visibilityPath = `/v1/funds/${fundId}/visibility`;
    const requestVisibility = (key: string, visibility: string, expectedVersion: number) =>
      api.request(visibilityPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ visibility, expectedVersion }),
      });
    const response = await requestVisibility("visibility-owner", "public", 1);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ visibility: "public", version: 2 });
    const replay = await requestVisibility("visibility-owner", "public", 1);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await new PostgresFundStore(secondSql).get(fundId))?.fund.visibility).toBe("public");
    expect(
      await sql`SELECT type, version FROM fund_events WHERE fund_id = ${fundId} ORDER BY seq DESC LIMIT 1`,
    ).toEqual([{ type: "fund.visibility_changed", version: 2 }]);
    const outsiderApi = createApp({
      fundStore: new PostgresFundStore(secondSql),
      principal: { id: await owner(), role: "owner" },
      policy: devPolicy,
    });
    expect(
      (
        await outsiderApi.request(visibilityPath, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "visibility-outsider" },
          body: JSON.stringify({ visibility: "members", expectedVersion: 2 }),
        })
      ).status,
    ).toBe(403);
    expect((await requestVisibility("visibility-stale", "members", 1)).status).toBe(409);
    await expect(
      store.changeVisibility({
        fundId,
        ownerUserId: userId,
        visibility: "members",
        expectedVersion: 1,
        occurredAt: createdAt,
      }),
    ).resolves.toBeNull();
  });

  it("makes membership revocation visible to a second API store on its next lookup", async () => {
    const { userId, fundId } = await createFund();
    const memberId = await owner();
    const first = new PostgresFundStore(sql);
    const second = new PostgresFundStore(secondSql);
    const memberApi = createApp({
      fundStore: second,
      principal: { id: memberId, role: "owner" },
      policy: devPolicy,
    });
    await first.addMember({
      fundId,
      actorUserId: userId,
      userId: memberId,
      role: "approver",
      occurredAt: createdAt,
    });
    expect(await second.rolesFor(fundId, memberId)).toEqual(["approver"]);
    expect((await memberApi.request(`/v1/funds/${fundId}`)).status).toBe(200);
    await first.changePolicy({
      fundId,
      actorUserId: userId,
      policy: { approvalQuorum: 3, objectionWindowHours: 12 },
      occurredAt: createdAt,
    });
    expect(await second.getPolicy(fundId)).toMatchObject({
      approvalQuorum: 3,
      objectionWindowHours: 12,
    });
    const observedPolicies: FundPolicy[] = [];
    const inMemoryExpenses = new InMemoryExpenseStore();
    const expenseStore: ExpenseStore = {
      get: inMemoryExpenses.get.bind(inMemoryExpenses),
      list: inMemoryExpenses.list.bind(inMemoryExpenses),
      save: async (expense, context) => {
        if (context?.policy) observedPolicies.push(context.policy);
        return inMemoryExpenses.save(expense);
      },
      atomicApprove: inMemoryExpenses.atomicApprove.bind(inMemoryExpenses),
    };
    const policyApi = createApp({
      fundStore: second,
      principal: { id: userId, role: "member" },
      policy: devPolicy,
      expenseStore,
    });
    const draftResponse = await policyApi.request(`/v1/funds/${fundId}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "policy-draft" },
      body: JSON.stringify({
        amountPaise: "2500",
        description: "Policy propagation test",
        recipientRef: "fixture-recipient",
        payee: {
          identity: { kind: "upi", vpa: "policy-test@yenbank" },
          name: "Policy Test Vendor",
        },
      }),
    });
    expect(draftResponse.status).toBe(201);
    const draft = (await draftResponse.json()) as { id: string };
    const submitResponse = await policyApi.request(
      `/v1/funds/${fundId}/expenses/${draft.id}/submit`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "policy-submit" },
      },
    );
    expect(submitResponse.status).toBe(200);
    expect(observedPolicies.at(-1)).toMatchObject({
      approvalQuorum: 3,
      objectionWindowHours: 12,
    });
    await first.removeMember({
      fundId,
      actorUserId: userId,
      userId: memberId,
      occurredAt: createdAt,
    });
    expect(await second.rolesFor(fundId, memberId)).toEqual([]);
    expect((await memberApi.request(`/v1/funds/${fundId}`)).status).toBe(404);
    expect(
      await sql`SELECT count(*)::int AS count FROM fund_events WHERE fund_id = ${fundId}`,
    ).toEqual([{ count: 4 }]);
  });

  it("uses a per-fund pseudonym for the owner event actor", async () => {
    const { userId, fundId } = await createFund();
    const expected = await ensureFundPseudonym(sql, { userId, fundId });
    expect(await sql`SELECT actor FROM fund_events WHERE fund_id = ${fundId}`).toEqual([
      { actor: expected },
    ]);
  });

  it("keeps private and unknown Postgres funds indistinguishable to anonymous callers", async () => {
    const { fundId } = await createFund();
    const app = createApp({ fundStore: new PostgresFundStore(sql), policy: devPolicy });
    const request = (id: string) =>
      app.request(`/v1/funds/${id}/public/summary`, {
        headers: { "x-request-id": "00000000-0000-4000-8000-000000000099" },
      });

    const privateResponse = await request(fundId);
    const privateBody = await privateResponse.text();
    const unknownResponse = await request(uuidv7());

    expect(privateResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.text()).toBe(privateBody);
    expect(Array.from(unknownResponse.headers.entries())).toEqual(
      Array.from(privateResponse.headers.entries()),
    );
  });
});
