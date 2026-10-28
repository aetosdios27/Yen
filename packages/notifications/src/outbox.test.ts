import { type Event, hashHexSchema, pseudonymIdSchema } from "@yen/eventlog";
import { paise, parseFundId, parseUserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { createNotificationsForEvent, enqueueNotification, type SqlTransaction } from "./outbox.js";

class MockTransaction implements SqlTransaction {
  public executedQueries: Array<{ query: string; params?: unknown[] | undefined }> = [];
  public rows = new Map<string, Record<string, unknown>>();
  public shouldFail = false;

  async unsafe(query: string, params?: unknown[]): Promise<unknown[]> {
    if (this.shouldFail) {
      throw new Error("Transaction aborted");
    }
    this.executedQueries.push({ query, params });

    if (query.includes("INSERT INTO notification_outbox")) {
      const idempotencyKey = params?.[4] as string;
      if (this.rows.has(idempotencyKey)) {
        // ON CONFLICT DO NOTHING returns empty
        return [];
      }
      const row = {
        id: params?.[0],
        fund_id: params?.[1],
        user_id: params?.[2],
        event_id: params?.[3],
        idempotency_key: idempotencyKey,
        template_id: params?.[5],
        template_data: JSON.parse(params?.[6] as string),
        preferred_channel: params?.[7],
        status: "pending",
        attempts: 0,
        max_attempts: params?.[8],
        next_attempt_at: params?.[9],
        lease_expires_at: null,
        delivered_at: null,
        channel_used: null,
        cost_paise: 0n,
        last_error: null,
        created_at: params?.[10],
        updated_at: params?.[11],
      };
      this.rows.set(idempotencyKey, row);
      return [row];
    }

    if (query.includes("SELECT * FROM notification_outbox WHERE idempotency_key")) {
      const key = params?.[0] as string;
      const found = this.rows.get(key);
      return found ? [found] : [];
    }

    return [];
  }
}

describe("Transactional Outbox", () => {
  const fundResult = parseFundId("11111111-1111-7111-8111-111111111111");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;

  const userResult = parseUserId("22222222-2222-7222-8222-222222222222");
  if (!userResult.ok) throw new Error(userResult.error);
  const userId = userResult.value;

  it("enqueues notification row within the same database transaction", async () => {
    const tx = new MockTransaction();
    const input = {
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-hash-123",
      idempotency_key: "notify:test:1",
      template_id: "approval_needed" as const,
      template_data: {
        fund_title: "Festival Fund",
        expense_id: "exp-1",
        amount_paise: 15000,
      },
    };

    const row = await enqueueNotification(tx, input);
    expect(row).toBeDefined();
    expect(row?.idempotency_key).toBe("notify:test:1");
    expect(row?.status).toBe("pending");
    expect(tx.executedQueries).toHaveLength(1);
    expect(tx.executedQueries[0]?.query).toContain("INSERT INTO notification_outbox");
  });

  it("proves transactional rollback when transaction fails", async () => {
    const tx = new MockTransaction();
    tx.shouldFail = true;

    await expect(
      enqueueNotification(tx, {
        fund_id: fundId,
        user_id: userId,
        idempotency_key: "notify:fail:1",
        template_id: "approval_needed",
        template_data: { fund_title: "Test", expense_id: "exp-1", amount_paise: 100 },
      }),
    ).rejects.toThrow("Transaction aborted");

    expect(tx.rows.size).toBe(0);
  });

  it("deduplicates by key when same notification is enqueued twice", async () => {
    const tx = new MockTransaction();
    const input = {
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-hash-123",
      idempotency_key: "notify:duplicate:key",
      template_id: "approval_needed" as const,
      template_data: { fund_title: "Test", expense_id: "exp-1", amount_paise: 500 },
    };

    const first = await enqueueNotification(tx, input);
    expect(first).toBeDefined();
    expect(tx.rows.size).toBe(1);

    // Second enqueue with same key
    const second = await enqueueNotification(tx, input);
    expect(second).toBeDefined();
    expect(second?.id).toBe(first?.id);
    expect(tx.rows.size).toBe(1); // No new row added
  });

  it("creates outbox rows for expense.submitted event", async () => {
    const tx = new MockTransaction();
    const actor = pseudonymIdSchema.parse("psn_33333333-3333-7333-8333-333333333333");
    const prevHash = hashHexSchema.parse("0".repeat(64));
    const eventHash = hashHexSchema.parse("a".repeat(64));

    const event = {
      fund_id: fundId,
      seq: 1,
      version: 1 as const,
      actor,
      occurred_at: "2026-10-28T14:00:00.000Z",
      type: "expense.submitted" as const,
      payload: { expense_id: "44444444-4444-7444-8444-444444444444", amount_paise: paise(5000) },
      prev_hash: prevHash,
      hash: eventHash,
    } as unknown as Event;

    const recipients = [{ userId, fundTitle: "Water Project" }];
    const outboxRows = await createNotificationsForEvent(tx, event, recipients);

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.template_id).toBe("approval_needed");
    expect(outboxRows[0]?.template_data).toMatchObject({
      fund_title: "Water Project",
      expense_id: "44444444-4444-7444-8444-444444444444",
    });
  });

  it("creates outbox rows for donation.pledged event", async () => {
    const tx = new MockTransaction();
    const actor = pseudonymIdSchema.parse("psn_33333333-3333-7333-8333-333333333333");
    const prevHash = hashHexSchema.parse("a".repeat(64));
    const eventHash = hashHexSchema.parse("b".repeat(64));

    const event = {
      fund_id: fundId,
      seq: 2,
      version: 1 as const,
      actor,
      occurred_at: "2026-10-28T14:05:00.000Z",
      type: "donation.pledged" as const,
      payload: { donation_id: "55555555-5555-7555-8555-555555555555", amount_paise: paise(25000) },
      prev_hash: prevHash,
      hash: eventHash,
    } as unknown as Event;

    const recipients = [{ userId, fundTitle: "Water Project" }];
    const outboxRows = await createNotificationsForEvent(tx, event, recipients);

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.template_id).toBe("donation_received");
    expect(outboxRows[0]?.template_data).toMatchObject({
      fund_title: "Water Project",
      donation_id: "55555555-5555-7555-8555-555555555555",
    });
  });
});
