import { randomUUID } from "node:crypto";
import {
  acknowledgeAlert,
  createSql,
  migrate,
  raiseAlert,
  resolveAlert,
  type Sql,
  SYSTEM_ALERT_ACTOR,
  uuidv7,
} from "@yen/db";
import type { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAlertEscalation } from "./alerts.js";
import { escalateDueAlerts } from "./escalation.js";
import { describePostgres } from "./test-utils.js";

const T0 = new Date("2026-10-30T10:00:00.000Z");
const minutesAfter = (minutes: number) => new Date(T0.getTime() + minutes * 60 * 1000);
const ACTOR = "psn_aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

describe("registerAlertEscalation schedule", () => {
  it("creates the queue, runs the worker every minute and schedules the job", async () => {
    const calls: string[] = [];
    const schedules: Array<{ name: string; cron: string }> = [];
    let handler: (() => Promise<void>) | undefined;
    const boss = {
      createQueue: async (name: string) => {
        calls.push(`createQueue:${name}`);
      },
      work: async (name: string, options: { batchSize: number }, fn: () => Promise<void>) => {
        calls.push(`work:${name}:${options.batchSize}`);
        handler = fn;
      },
      schedule: async (name: string, cron: string) => {
        schedules.push({ name, cron });
      },
    } as unknown as PgBoss;

    await registerAlertEscalation(boss, {} as Sql);

    expect(calls).toEqual(["createQueue:alert-escalation", "work:alert-escalation:1"]);
    expect(schedules).toEqual([{ name: "alert-escalation", cron: "*/1 * * * *" }]);
    expect(handler).toBeTypeOf("function");
  });
});

describePostgres("critical alert escalation", (adminUrl) => {
  const admin = createSql(adminUrl);
  let sql: Sql;
  let dbName: string;

  beforeEach(async () => {
    vi.stubEnv("ALERT_ESCALATION_MINUTES", undefined);
    dbName = `yen_queue_esc_${randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    sql = createSql(url.toString());
    await migrate(sql);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  });

  afterAll(async () => {
    await admin.end({ timeout: 5 });
  });

  async function seedFund() {
    const ownerId = uuidv7();
    const approverId = uuidv7();
    const memberId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    await sql`INSERT INTO users (id, phone, display_name) VALUES
      (${ownerId}, '+919000000101', 'Owner Person'),
      (${approverId}, '+919000000102', 'Approver Person'),
      (${memberId}, '+919000000103', 'Member Person')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id)
      VALUES (${orgId}, 'Test Org', 'trust', ${ownerId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json)
      VALUES (${fundId}, ${orgId}, 'Community Water Fund', '{}')`;
    await sql`INSERT INTO memberships (fund_id, user_id, role, status) VALUES
      (${fundId}, ${ownerId}, 'owner', 'active'),
      (${fundId}, ${approverId}, 'approver', 'active'),
      (${fundId}, ${memberId}, 'member', 'active')`;
    return { fundId, ownerId, approverId };
  }

  function raiseCritical(fundId: string, now: Date) {
    return raiseAlert(sql, {
      fundId,
      alertType: "unapproved_debit",
      severity: "critical",
      title: "Unapproved debit",
      details: "A debit posted without approval",
      entityType: "fund",
      entityId: fundId,
      now,
    });
  }

  async function escalatedEventCount(alertId: string): Promise<number> {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM alert_events
      WHERE alert_id = ${alertId} AND event_type = 'escalated'
    `;
    return rows[0]?.count ?? 0;
  }

  async function outboxFor(alertId: string) {
    return sql<
      {
        user_id: string;
        template_id: string;
        template_data: Record<string, unknown>;
        status: string;
      }[]
    >`
      SELECT user_id, template_id, template_data, status
      FROM notification_outbox WHERE event_id = ${alertId}
    `;
  }

  it("does not escalate a critical alert before its due time", async () => {
    const { fundId } = await seedFund();
    const alert = await raiseCritical(fundId, T0);
    expect(alert).not.toBeNull();

    expect(await escalateDueAlerts(sql, minutesAfter(59))).toBe(0);

    const [row] = await sql<{ escalated_at: Date | null }[]>`
      SELECT escalated_at FROM alerts WHERE id = ${alert?.id ?? ""}
    `;
    expect(row?.escalated_at).toBeNull();
    expect(await escalatedEventCount(alert?.id ?? "")).toBe(0);
    expect(await outboxFor(alert?.id ?? "")).toHaveLength(0);
  });

  it("escalates a due critical alert once and notifies only the fund owner", async () => {
    const { fundId, ownerId } = await seedFund();
    const alert = await raiseCritical(fundId, T0);
    const alertId = alert?.id ?? "";

    expect(await escalateDueAlerts(sql, minutesAfter(60))).toBe(1);

    const [row] = await sql<{ escalated_at: Date }[]>`
      SELECT escalated_at FROM alerts WHERE id = ${alertId}
    `;
    expect(row?.escalated_at?.toISOString()).toBe(minutesAfter(60).toISOString());

    const events = await sql<{ actor_pseudonym: string; note: string }[]>`
      SELECT actor_pseudonym, note FROM alert_events
      WHERE alert_id = ${alertId} AND event_type = 'escalated'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_pseudonym).toBe(SYSTEM_ALERT_ACTOR);

    const outbox = await outboxFor(alertId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.user_id).toBe(ownerId);
    expect(outbox[0]?.template_id).toBe("fund_alert");
    expect(outbox[0]?.status).toBe("pending");
    expect(outbox[0]?.template_data).toMatchObject({
      fund_title: "Community Water Fund",
      alert_type: "unapproved_debit",
      severity: "critical",
      variant: "escalation",
    });
  });

  it("a second run after escalation is a no-op and writes no new rows", async () => {
    const { fundId } = await seedFund();
    const alertId = (await raiseCritical(fundId, T0))?.id ?? "";
    expect(await escalateDueAlerts(sql, minutesAfter(60))).toBe(1);

    expect(await escalateDueAlerts(sql, minutesAfter(61))).toBe(0);
    expect(await escalateDueAlerts(sql, minutesAfter(600))).toBe(0);

    expect(await escalatedEventCount(alertId)).toBe(1);
    expect(await outboxFor(alertId)).toHaveLength(1);
  });

  it("never escalates an acknowledged critical alert", async () => {
    const { fundId } = await seedFund();
    const alertId = (await raiseCritical(fundId, T0))?.id ?? "";
    await acknowledgeAlert(sql, {
      alertId,
      actorPseudonym: ACTOR,
      note: "Looking into it",
      now: minutesAfter(10),
    });

    expect(await escalateDueAlerts(sql, minutesAfter(180))).toBe(0);

    const [row] = await sql<{ escalated_at: Date | null }[]>`
      SELECT escalated_at FROM alerts WHERE id = ${alertId}
    `;
    expect(row?.escalated_at).toBeNull();
    expect(await escalatedEventCount(alertId)).toBe(0);
    expect(await outboxFor(alertId)).toHaveLength(0);
  });

  it("never escalates a resolved critical alert", async () => {
    const { fundId } = await seedFund();
    const alertId = (await raiseCritical(fundId, T0))?.id ?? "";
    // The schema only allows resolving an acknowledged alert (alerts_check4), so acknowledge first.
    await acknowledgeAlert(sql, {
      alertId,
      actorPseudonym: ACTOR,
      note: "Looking into it",
      now: minutesAfter(5),
    });
    await resolveAlert(sql, {
      alertId,
      actorPseudonym: ACTOR,
      note: "Reversed the debit",
      now: minutesAfter(10),
    });

    expect(await escalateDueAlerts(sql, minutesAfter(180))).toBe(0);

    expect(await escalatedEventCount(alertId)).toBe(0);
    expect(await outboxFor(alertId)).toHaveLength(0);
  });

  it("never escalates a warning alert, even when its due time has passed", async () => {
    const { fundId } = await seedFund();
    const warning = await raiseAlert(sql, {
      fundId,
      alertType: "spend_rate_spike",
      severity: "warning",
      title: "Spend rate spike",
      details: "Paid more than usual",
      entityType: "fund",
      entityId: fundId,
      escalationDueAt: T0,
      now: T0,
    });
    const alertId = warning?.id ?? "";

    expect(await escalateDueAlerts(sql, minutesAfter(600))).toBe(0);

    const [row] = await sql<{ escalated_at: Date | null }[]>`
      SELECT escalated_at FROM alerts WHERE id = ${alertId}
    `;
    expect(row?.escalated_at).toBeNull();
    expect(await outboxFor(alertId)).toHaveLength(0);
  });

  it("honors ALERT_ESCALATION_MINUTES for the delay", async () => {
    vi.stubEnv("ALERT_ESCALATION_MINUTES", "15");
    const { fundId } = await seedFund();
    const alertId = (await raiseCritical(fundId, T0))?.id ?? "";

    expect(await escalateDueAlerts(sql, minutesAfter(14))).toBe(0);
    expect(await escalatedEventCount(alertId)).toBe(0);

    expect(await escalateDueAlerts(sql, minutesAfter(15))).toBe(1);
    expect(await escalatedEventCount(alertId)).toBe(1);
  });

  it("the scheduled worker handler runs the same escalation", async () => {
    const { fundId } = await seedFund();
    const alertId = (await raiseCritical(fundId, T0))?.id ?? "";
    let handler: (() => Promise<void>) | undefined;
    const boss = {
      createQueue: async () => undefined,
      work: async (_name: string, _options: unknown, fn: () => Promise<void>) => {
        handler = fn;
      },
      schedule: async () => undefined,
    } as unknown as PgBoss;

    await registerAlertEscalation(boss, sql);
    // The registered handler reads the real clock, so the alert must already be due.
    await sql`UPDATE alerts SET escalation_due_at = ${new Date(Date.now() - 1000)} WHERE id = ${alertId}`;
    await handler?.();

    expect(await escalatedEventCount(alertId)).toBe(1);
    expect(await outboxFor(alertId)).toHaveLength(1);
  });
});
