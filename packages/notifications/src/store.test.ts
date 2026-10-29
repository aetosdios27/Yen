import type { NotificationOutboxRow } from "@yen/db";
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
