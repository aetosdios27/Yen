import { randomInt } from "node:crypto";
import { migrate, raiseAlert, uuidv7 } from "@yen/db";
import { recordDonation, SYSTEM_ACTOR } from "@yen/ledger";
import { paise } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { type AlertStore, PostgresAlertStore } from "./alert-store.js";
import { createApp } from "./app.js";
import { MemoryFundStore, type Principal } from "./dependencies.js";
import { PostgresExpenseStore } from "./expense-store.js";
import {
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  MemoryPinStore,
  PinService,
} from "./pin/index.js";
import { DEFAULT_OBJECTION_WINDOW_HOURS, devPolicy } from "./policy.js";

const PIN = "482915";
const HOUR_MS = 3_600_000;

databaseSuite("Postgres fund alerts API", (sql) => {
  // Real time plus an offset: the ledger stamps donations with wall-clock time, so the
  // API clock must never run behind it.
  let offsetMs = 0;
  const clock = () => Date.now() + offsetMs;
  const pinStore = new MemoryPinStore({ clock });
  const actionTokenStore = new MemoryActionTokenStore({ clock });
  const pinNotificationService = new MemoryPinNotificationService();
  const pinSecret = "test_pin_hmac_secret_32_bytes_long_env_kms";
  const pinService = new PinService({
    pinStore,
    actionTokenStore,
    notificationService: pinNotificationService,
    pinSecret,
    otpVerifier: null,
    clock,
  });
  const fundStore = new MemoryFundStore();
  const expenseStore = new PostgresExpenseStore(sql);
  const alertStore = new PostgresAlertStore(sql);

  const appAs = (
    principal: Principal | null,
    overrides: { alertStore?: AlertStore; logger?: { log: (entry: unknown) => void } } = {},
  ) =>
    createApp({
      principal,
      fundStore,
      expenseStore,
      alertStore,
      policy: devPolicy,
      pinStore,
      actionTokenStore,
      pinNotificationService,
      pinSecret,
      pinService,
      clock,
      logger: { log: () => undefined },
      ...overrides,
    });

  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
  });

  async function user(name: string): Promise<string> {
    const id = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${id}, ${phone}, ${name})`;
    await pinService.setupPin(id, PIN, { userId: id });
    return id;
  }

  async function createFund(ownerId: string, visibility = "private"): Promise<string> {
    const response = await appAs({ id: ownerId, role: "owner" }).request("/v1/funds", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": uuidv7() },
      body: JSON.stringify({
        name: "Alerts Fund",
        targetPaise: "5000000",
        upiVpa: "alerts@yenbank",
        upiPayeeName: "Alerts Club",
        visibility,
      }),
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const orgId = uuidv7();
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Alerts Org', 'society', ${ownerId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${id}, ${orgId}, 'Alerts Fund', '{}'::jsonb)`;
    await sql.begin((tx) =>
      recordDonation(tx, { fundId: id, amount: paise(1_000_000), actorPseudonym: SYSTEM_ACTOR }),
    );
    return id;
  }

  async function raise(fundId: string, title: string, details: string) {
    const alert = await raiseAlert(sql, {
      fundId,
      alertType: "unapproved_debit",
      severity: "critical",
      title,
      details,
      entityType: "bank_transaction",
      entityId: uuidv7(),
    });
    if (!alert) throw new Error("alert fixture was deduplicated");
    return alert;
  }

  async function submittedExpense(
    owner: ReturnType<typeof appAs>,
    fundId: string,
    amountPaise: string,
  ): Promise<string> {
    const created = await owner.request(`/v1/funds/${fundId}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
      body: JSON.stringify({
        amountPaise,
        description: "Supplies",
        recipientRef: "alerts-supplier",
        payee: {
          identity: { kind: "upi", vpa: "alerts-supplier@yenbank" },
          name: "Supplier",
        },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const submitted = await owner.request(`/v1/funds/${fundId}/expenses/${id}/submit`, {
      method: "POST",
      headers: { "idempotency-key": uuidv7() },
    });
    expect(submitted.status).toBe(200);
    return id;
  }

  function reject(owner: ReturnType<typeof appAs>, fundId: string, expenseId: string) {
    return owner.request(`/v1/funds/${fundId}/expenses/${expenseId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
      body: JSON.stringify({ reason: "policy", pin: PIN }),
    });
  }

  async function paidExpense(ownerId: string, fundId: string, amountPaise: string): Promise<void> {
    const owner = appAs({ id: ownerId, role: "owner" });
    const expenseId = await submittedExpense(owner, fundId, amountPaise);
    // Approvals only reach quorum after the default objection window closes.
    offsetMs += (DEFAULT_OBJECTION_WINDOW_HOURS + 1) * HOUR_MS;
    for (const approverId of [await user("Approver One"), await user("Approver Two")]) {
      const response = await appAs({ id: approverId, role: "approver" }).request(
        `/v1/funds/${fundId}/expenses/${expenseId}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
          body: JSON.stringify({ pin: PIN }),
        },
      );
      expect(response.status).toBe(200);
    }
    const bankTransactionId = uuidv7();
    await sql`
      INSERT INTO bank_transactions (
        id, fund_id, bank_reference, amount_paise, type, posted_at, source, raw_payload
      ) VALUES (
        ${bankTransactionId}, ${fundId}, ${`alerts-${bankTransactionId}`}, ${amountPaise}, 'debit',
        ${new Date(clock()).toISOString()}, 'statement_upload', '{}'::jsonb
      )
    `;
    const response = await owner.request(`/v1/funds/${fundId}/expenses/${expenseId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
      body: JSON.stringify({ pin: PIN, bankTransactionId }),
    });
    expect(response.status).toBe(200);
  }

  it("lists alerts for fund members and rejects non-members with 403", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const alert = await raise(fundId, "Unapproved debit", "Debit of 5000 without approval");

    const memberId = await user("Member");
    const member = await appAs({ id: memberId, role: "member" }).request(
      `/v1/funds/${fundId}/alerts`,
    );
    expect(member.status).toBe(200);
    const alerts = (await member.json()) as Record<string, unknown>[];
    expect(alerts).toEqual([
      {
        id: alert.id,
        alertType: "unapproved_debit",
        severity: "critical",
        status: "open",
        title: "Unapproved debit",
        details: "Debit of 5000 without approval",
        createdAt: alert.created_at.toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
        escalatedAt: null,
      },
    ]);

    const outsider = await appAs({ id: uuidv7() }).request(`/v1/funds/${fundId}/alerts`);
    expect(outsider.status).toBe(403);
    expect(((await outsider.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("validates the list page size and pages with the created_at cursor", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const owner = appAs({ id: ownerId, role: "owner" });
    const older = await raise(fundId, "Older alert", "first");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await raise(fundId, "Newer alert", "second");

    const tooLarge = await owner.request(`/v1/funds/${fundId}/alerts?limit=101`);
    expect(tooLarge.status).toBe(400);

    const firstPage = (await (
      await owner.request(`/v1/funds/${fundId}/alerts?limit=1`)
    ).json()) as { id: string; createdAt: string }[];
    expect(firstPage.map((item) => item.id)).toEqual([newer.id]);

    const secondPage = (await (
      await owner.request(
        `/v1/funds/${fundId}/alerts?limit=1&before=${encodeURIComponent(firstPage[0]?.createdAt ?? "")}`,
      )
    ).json()) as { id: string }[];
    expect(secondPage.map((item) => item.id)).toEqual([older.id]);
  });

  it("acknowledges then resolves an alert and writes an alert_events row for each step", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const alert = await raise(fundId, "Balance drift", "Ledger differs from bank by 300");
    const approverId = await user("Approver");

    const ack = await appAs({ id: ownerId, role: "owner" }).request(
      `/v1/funds/${fundId}/alerts/${alert.id}/acknowledge`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
        body: JSON.stringify({ note: "Checking the statement" }),
      },
    );
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({
      id: alert.id,
      status: "acknowledged",
      acknowledgedAt: expect.any(String),
      resolvedAt: null,
    });

    const resolve = await appAs({ id: approverId, role: "approver" }).request(
      `/v1/funds/${fundId}/alerts/${alert.id}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
        body: JSON.stringify({ note: "Statement reconciled" }),
      },
    );
    expect(resolve.status).toBe(200);
    expect(await resolve.json()).toMatchObject({
      status: "resolved",
      resolvedAt: expect.any(String),
    });

    const events = await sql<{ event_type: string; actor_pseudonym: string; note: string }[]>`
      SELECT event_type, actor_pseudonym, note FROM alert_events
      WHERE alert_id = ${alert.id} ORDER BY created_at, id
    `;
    expect(events.map(({ event_type, note }) => ({ event_type, note }))).toEqual([
      { event_type: "acknowledged", note: "Checking the statement" },
      { event_type: "resolved", note: "Statement reconciled" },
    ]);
    expect(events[0]?.actor_pseudonym).toMatch(/^psn_[0-9a-f-]{36}$/);
    expect(events[0]?.actor_pseudonym).not.toBe(ownerId);
  });

  it("rejects blank, missing and oversized notes with 400 and refuses treasurers", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const alert = await raise(fundId, "Anchor missing", "No anchor for day 12");
    const owner = appAs({ id: ownerId, role: "owner" });
    const url = `/v1/funds/${fundId}/alerts/${alert.id}/acknowledge`;
    const post = (body: unknown) =>
      owner.request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
        body: JSON.stringify(body),
      });

    for (const body of [{ note: "   " }, {}, { note: "x".repeat(1001) }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "validation_failed",
      );
    }
    const events = await sql`SELECT id FROM alert_events WHERE alert_id = ${alert.id}`;
    expect(events).toHaveLength(0);

    const treasurer = await appAs({ id: await user("Treasurer"), role: "treasurer" }).request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
      body: JSON.stringify({ note: "Not my call" }),
    });
    expect(treasurer.status).toBe(403);
  });

  it("returns 409 for acknowledging or resolving an alert that is already resolved", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const alert = await raise(fundId, "Integrity check failed", "Chain break at seq 40");
    const owner = appAs({ id: ownerId, role: "owner" });
    const act = (action: "acknowledge" | "resolve") =>
      owner.request(`/v1/funds/${fundId}/alerts/${alert.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
        body: JSON.stringify({ note: "Handled" }),
      });

    // An open alert can be resolved without a separate acknowledgement.
    expect((await act("resolve")).status).toBe(200);
    expect((await act("acknowledge")).status).toBe(409);
    expect((await act("resolve")).status).toBe(409);
  });

  it("returns 404 when an alert from another fund is addressed through this fund", async () => {
    const ownerId = await user("Owner");
    const fundA = await createFund(ownerId);
    const fundB = await createFund(ownerId);
    const alertB = await raise(fundB, "Other fund alert", "Belongs to fund B");
    const owner = appAs({ id: ownerId, role: "owner" });

    const ack = await owner.request(`/v1/funds/${fundA}/alerts/${alertB.id}/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": uuidv7() },
      body: JSON.stringify({ note: "Wrong fund" }),
    });
    expect(ack.status).toBe(404);
    const list = await owner.request(`/v1/funds/${fundA}/alerts`);
    expect(await list.json()).toEqual([]);
  });

  it("keeps alert title and details out of the public timeline bytes", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId, "public");
    await raise(fundId, "Unique title ZETA-777", "Details ZETA-888 with amount 99999");
    const path = `/v1/funds/${fundId}/public/timeline`;

    const publicResponse = await appAs(null).request(path);
    expect(publicResponse.status).toBe(200);
    const publicBytes = await publicResponse.text();
    expect(publicBytes).toContain('"alertType":"unapproved_debit"');
    expect(publicBytes).toContain('"severity":"critical"');
    expect(publicBytes).not.toContain("ZETA");
    expect(publicBytes).not.toContain("99999");

    const memberResponse = await appAs({ id: await user("Member"), role: "member" }).request(path);
    expect(memberResponse.status).toBe(200);
    expect(await memberResponse.text()).toContain("Unique title ZETA-777");
  });

  it("raises exactly one repeated_rejected_requests alert after three rejections in 7 days", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const owner = appAs({ id: ownerId, role: "owner" });

    for (let index = 0; index < 3; index++) {
      const expenseId = await submittedExpense(owner, fundId, "30000");
      const response = await reject(owner, fundId, expenseId);
      expect(response.status).toBe(200);
    }
    const afterThree = await sql<{ alert_type: string }[]>`
      SELECT alert_type FROM alerts WHERE fund_id = ${fundId}
    `;
    expect(afterThree.map((row) => row.alert_type)).toEqual(["repeated_rejected_requests"]);

    const fourth = await submittedExpense(owner, fundId, "30000");
    expect((await reject(owner, fundId, fourth)).status).toBe(200);
    const afterFour = await sql<{ alert_type: string }[]>`
      SELECT alert_type FROM alerts WHERE fund_id = ${fundId}
    `;
    expect(afterFour.map((row) => row.alert_type)).toEqual(["repeated_rejected_requests"]);
  });

  it("does not fail a reject when the alert hook throws, and logs the failure", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);
    const logged: unknown[] = [];
    const failingHooks = new Proxy(alertStore, {
      get: (target, property) =>
        property === "onExpenseRejected"
          ? async () => {
              throw new Error("alert hook unavailable");
            }
          : Reflect.get(target, property, target),
    });
    const owner = appAs(
      { id: ownerId, role: "owner" },
      {
        alertStore: failingHooks,
        logger: { log: (entry) => logged.push(entry) },
      },
    );
    const expenseId = await submittedExpense(owner, fundId, "30000");

    const response = await reject(owner, fundId, expenseId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "rejected" });
    const failures = logged.filter(
      (entry) => (entry as { event?: string }).event === "http_failure",
    );
    expect(failures).toEqual([expect.objectContaining({ errorName: "Error", errorKind: "store" })]);
  });

  it("raises exactly one spend_rate_spike alert when a large payment lands", async () => {
    const ownerId = await user("Owner");
    const fundId = await createFund(ownerId);

    await paidExpense(ownerId, fundId, "150000");

    const rows = await sql<{ alert_type: string; severity: string }[]>`
      SELECT alert_type, severity FROM alerts WHERE fund_id = ${fundId}
    `;
    expect(rows).toEqual([{ alert_type: "spend_rate_spike", severity: "warning" }]);
  });
});
