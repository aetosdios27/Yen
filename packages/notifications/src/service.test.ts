import type { NotificationOutboxRow } from "@yen/db";
import { type Event, hashHexSchema, pseudonymIdSchema } from "@yen/eventlog";
import type { WorkerRuntime } from "@yen/queue";
import { type FundId, paise, parseFundId, parseUserId, type UserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { InMemoryChannelProvider, InMemoryDeliveryProvider } from "./channels/in-memory.js";
import { NotificationsService } from "./service.js";
import { InMemoryNotificationStore } from "./store.js";
import type { NotificationChannel, NotificationTemplateId } from "./types.js";

describe("NotificationsService (End-to-End Integration)", () => {
  const fundResult = parseFundId("11111111-1111-7111-8111-111111111111");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;

  const userResult = parseUserId("22222222-2222-7222-8222-222222222222");
  if (!userResult.ok) throw new Error(userResult.error);
  const userId = userResult.value;

  function createService(queueRuntime?: WorkerRuntime) {
    const store = new InMemoryNotificationStore();
    const whatsapp = new InMemoryChannelProvider("whatsapp");
    const sms = new InMemoryChannelProvider("sms");

    store.setUserContact(userId, {
      phone: "+919876543210",
    });

    const mockTx = {
      unsafe: async (query: string, params?: unknown[]) => {
        if (query.includes("INSERT INTO notification_outbox")) {
          const idempotencyKey = params?.[4] as string;
          for (const row of store.outbox.values()) {
            if (row.idempotency_key === idempotencyKey) {
              return [];
            }
          }
          const row: NotificationOutboxRow = {
            id: params?.[0] as string,
            fund_id: params?.[1] as FundId,
            user_id: params?.[2] as UserId,
            event_id: (params?.[3] as string | null) ?? null,
            idempotency_key: idempotencyKey,
            template_id: params?.[5] as NotificationTemplateId,
            template_data: JSON.parse(params?.[6] as string),
            preferred_channel: (params?.[7] as NotificationChannel) ?? "whatsapp",
            status: "pending",
            attempts: 0,
            max_attempts: params?.[8] as number,
            next_attempt_at: new Date("2020-01-01T00:00:00.000Z"),
            lease_expires_at: null,
            delivered_at: null,
            channel_used: null,
            cost_paise: 0n,
            last_error: null,
            created_at: params?.[10] as Date,
            updated_at: params?.[11] as Date,
          };
          store.outbox.set(row.id, row);
          return [row];
        }
        if (query.includes("SELECT * FROM notification_outbox WHERE idempotency_key")) {
          const key = params?.[0] as string;
          for (const row of store.outbox.values()) {
            if (row.idempotency_key === key) {
              return [row];
            }
          }
          return [];
        }
        return [];
      },
    };

    const service = new NotificationsService({
      store,
      whatsappProvider: whatsapp,
      smsProvider: sms,
      queueRuntime,
      workerOptions: { clock: () => new Date("2026-10-28T14:00:00.000Z") },
    });

    return { service, store, whatsapp, sms, mockTx };
  }

  it("requires explicit shared providers in production", () => {
    const store = new InMemoryNotificationStore();
    expect(() => new NotificationsService({ store, environment: "production" })).toThrow(
      "Production notification delivery providers are required",
    );
    const provider = new InMemoryDeliveryProvider();
    expect(
      () =>
        new NotificationsService({
          store,
          environment: "production",
          deliveryProviders: { whatsapp: provider, sms: provider },
        }),
    ).not.toThrow();
  });

  it("handles event emission and delivers notification end-to-end", async () => {
    const { service, store, whatsapp, mockTx } = createService();

    const actor = pseudonymIdSchema.parse("psn_33333333-3333-7333-8333-333333333333");
    const prevHash = hashHexSchema.parse("0".repeat(64));
    const eventHash = hashHexSchema.parse("f".repeat(64));

    const event = {
      fund_id: fundId,
      seq: 1,
      version: 1 as const,
      actor,
      occurred_at: "2026-10-28T14:00:00.000Z",
      type: "expense.submitted" as const,
      payload: { expense_id: "exp-123", amount_paise: paise(100000) },
      prev_hash: prevHash,
      hash: eventHash,
    } as unknown as Event;

    // 1. Transactional event handling creates notification outbox row
    const outboxRows = await service.handleEvent(mockTx, event, [
      { userId, fundTitle: "Water Restoration" },
    ]);
    expect(outboxRows).toHaveLength(1);
    expect(store.outbox.size).toBe(1);

    // 2. Worker processes batch and delivers via WhatsApp
    const batchResult = await service.processPending();
    expect(batchResult.delivered).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(1);
    expect(whatsapp.sentMessages[0]?.recipientContact).toBe("+919876543210");
    expect(whatsapp.sentMessages[0]?.renderedBody).toContain("₹1,000.00");

    // 3. Status updated to delivered with 30 paise cost recorded
    const firstRow = outboxRows[0];
    expect(firstRow).toBeDefined();
    if (firstRow) {
      const deliveredRow = store.outbox.get(firstRow.id);
      expect(deliveredRow?.status).toBe("delivered");
      expect(deliveredRow?.channel_used).toBe("whatsapp");
      expect(deliveredRow?.cost_paise).toBe(30n);
    }

    // 4. Daily fund usage tracked
    const usage = await service.getFundDailyUsage(fundId, "2026-10-28");
    expect(usage.sent_count).toBe(1);
    expect(usage.total_cost_paise).toBe(30);
  });

  it("uses the shared queue runtime for transactional wakeups", async () => {
    const queuedJobs: Array<{ name: string; data: unknown; options: unknown }> = [];
    let registeredQueue: string | undefined;
    let handler: ((job: unknown) => Promise<void>) | undefined;
    const runtime = {
      registerHandler: (queue: string, registeredHandler: (job: unknown) => Promise<void>) => {
        registeredQueue = queue;
        handler = registeredHandler;
      },
      getBoss: () => ({
        send: async (name: string, data: unknown, options: unknown) => {
          queuedJobs.push({ name, data, options });
          return "queue-job-1";
        },
      }),
    } as unknown as WorkerRuntime;
    const { service, mockTx } = createService(runtime);

    await service.enqueue(mockTx, {
      fund_id: fundId,
      user_id: userId,
      idempotency_key: "notify:queue-runtime:1",
      template_id: "donation_received",
      template_data: {
        fund_title: "Community Fund",
        donation_id: "donation-1",
        amount_paise: 1000,
      },
      preferred_channel: "sms",
    });

    expect(registeredQueue).toBe("notifications");
    expect(queuedJobs).toHaveLength(1);
    expect(queuedJobs[0]?.name).toBe("notifications");
    expect(queuedJobs[0]?.options).toHaveProperty("db");
    expect(handler).toBeDefined();
    await handler?.({});
  });
});
