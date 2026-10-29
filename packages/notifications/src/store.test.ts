import type { NotificationOutboxRow } from "@yen/db";
import { fundIdSchema, paise } from "@yen/shared";
import { expect, it } from "vitest";
import { PostgresNotificationStore } from "./store.js";

it("decodes JSONB template data returned as text by the raw Postgres claim query", async () => {
  const row = {
    id: "01a18654-e471-789c-b4f2-88313eb222e3",
    fund_id: "01a18654-e471-789c-b4f2-88313eb222e4",
    user_id: "01a18654-e471-789c-b4f2-88313eb222e5",
    event_id: null,
    idempotency_key: "notify:test",
    template_id: "donation_received",
    template_data: JSON.stringify({
      fund_title: "Test fund",
      donation_id: "don-1",
      amount_paise: 100,
    }),
    preferred_channel: "whatsapp",
    status: "processing",
    attempts: 1,
    max_attempts: 3,
    next_attempt_at: new Date(),
    lease_expires_at: new Date(Date.now() + 60_000),
    claim_token: "claim-token",
    delivered_at: null,
    channel_used: null,
    cost_paise: 0n,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as NotificationOutboxRow;
  const store = new PostgresNotificationStore({
    unsafe: async () => [row],
  });

  const claimed = await store.claimBatch(1, new Date(Date.now() + 60_000));
  expect(claimed[0]?.template_data).toEqual({
    fund_title: "Test fund",
    donation_id: "don-1",
    amount_paise: 100,
  });
});

it("applies a provider delivery event received before its submitted ID is stored", async () => {
  const { InMemoryNotificationStore } = await import("./store.js");
  const store = new InMemoryNotificationStore();
  store.outbox.set("notification-1", {
    id: "notification-1",
    fund_id: "fund-1",
    user_id: "user-1",
    event_id: null,
    idempotency_key: "notification-idempotency-1",
    template_id: "donation_received",
    template_data: { fund_title: "Fund", donation_id: "donation-1", amount_paise: 100 },
    preferred_channel: "whatsapp",
    status: "processing",
    attempts: 1,
    max_attempts: 3,
    next_attempt_at: new Date(0),
    lease_expires_at: new Date(Date.now() + 60_000),
    claim_token: "claim-1",
    delivered_at: null,
    channel_used: null,
    cost_paise: 0n,
    last_error: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  } as unknown as NotificationOutboxRow);
  expect(
    await store.prepareSend({
      notificationId: "notification-1",
      claimToken: "claim-1",
      fundId: fundIdSchema.parse("00000000-0000-0000-0000-000000000001"),
      date: "2026-10-29",
      costPaise: paise(30),
      now: new Date(),
    }),
  ).toBe("prepared");
  expect(
    await store.applyDeliveryStatus(
      "meta_whatsapp",
      "wamid-fake",
      "delivered",
      "event-delivered",
      new Date("2026-10-29T10:00:00.000Z"),
    ),
  ).toBe(true);
  expect(
    await store.applyDeliveryStatus(
      "meta_whatsapp",
      "wamid-fake",
      "dead_letter",
      "event-older-failed",
      new Date("2026-10-29T09:59:00.000Z"),
    ),
  ).toBe(true);
  expect(
    await store.markSubmitted("notification-1", "claim-1", "whatsapp", paise(30), "wamid-fake"),
  ).toBe(true);
  expect(
    await store.applyDeliveryStatus(
      "meta_whatsapp",
      "wamid-fake",
      "delivered",
      "event-delivered",
      new Date("2026-10-29T10:00:00.000Z"),
    ),
  ).toBe(false);
  expect(store.outbox.get("notification-1")?.status).toBe("delivered");
  expect(store.fundDailyUsage.get("00000000-0000-0000-0000-000000000001:2026-10-29")).toMatchObject(
    {
      sent_count: 1,
      total_cost_paise: paise(30),
    },
  );
});

it("dead-letters an expired send marker without reclaiming and resending it", async () => {
  const { InMemoryNotificationStore } = await import("./store.js");
  const store = new InMemoryNotificationStore();
  store.outbox.set("notification-2", {
    id: "notification-2",
    fund_id: "fund-1",
    user_id: "user-1",
    event_id: null,
    idempotency_key: "notification-idempotency-2",
    template_id: "donation_received",
    template_data: { fund_title: "Fund", donation_id: "donation-2", amount_paise: 100 },
    preferred_channel: "whatsapp",
    status: "sending",
    attempts: 1,
    max_attempts: 3,
    next_attempt_at: new Date(0),
    lease_expires_at: new Date(1),
    claim_token: "claim-2",
    delivered_at: null,
    channel_used: null,
    cost_paise: 0n,
    last_error: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  } as unknown as NotificationOutboxRow);
  expect(await store.claimBatch(10, new Date(3000), new Date(2000))).toHaveLength(0);
  expect(store.outbox.get("notification-2")?.status).toBe("dead_letter");
});
