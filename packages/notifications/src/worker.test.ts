import { paise, parseFundId, parseUserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { InMemoryChannelProvider } from "./channels/in-memory.js";
import { InMemoryNotificationStore } from "./store.js";
import { NotificationsWorker } from "./worker.js";

describe("NotificationsWorker (Delivery, Fallback, Crash Resilience, Cost Guard, DLQ)", () => {
  const fundResult = parseFundId("11111111-1111-7111-8111-111111111111");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;

  const userResult = parseUserId("22222222-2222-7222-8222-222222222222");
  if (!userResult.ok) throw new Error(userResult.error);
  const userId = userResult.value;

  function setup() {
    const store = new InMemoryNotificationStore();
    const whatsapp = new InMemoryChannelProvider("whatsapp");
    const sms = new InMemoryChannelProvider("sms");
    const email = new InMemoryChannelProvider("email");

    store.setUserContact(userId, {
      phone: "+919876543210",
      email: "user@example.com",
    });

    let currentTime = new Date("2026-10-28T10:00:00.000Z"); // Daytime 10:00 UTC
    const clock = () => currentTime;
    const advanceMinutes = (mins: number) => {
      currentTime = new Date(currentTime.getTime() + mins * 60 * 1000);
    };

    const worker = new NotificationsWorker({
      store,
      whatsappProvider: whatsapp,
      smsProvider: sms,
      emailProvider: email,
      clock,
      leaseDurationMs: 60_000,
      backoffBaseSeconds: 5,
    });

    return { store, whatsapp, sms, email, worker, clock, advanceMinutes };
  }

  it("delivers via WhatsApp (primary) and records 30 paise cost", async () => {
    const { store, whatsapp, sms, worker } = setup();

    store.outbox.set("notif-1", {
      id: "notif-1",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-1",
      idempotency_key: "idem-1",
      template_id: "approval_needed",
      template_data: {
        fund_title: "Village Solar Fund",
        expense_id: "exp-1",
        amount_paise: 50000,
      },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    const summary = await worker.processNextBatch();

    expect(summary.claimed).toBe(1);
    expect(summary.delivered).toBe(1);

    expect(whatsapp.sentMessages).toHaveLength(1);
    expect(sms.sentMessages).toHaveLength(0); // Primary WhatsApp succeeded, SMS not needed

    const row = store.outbox.get("notif-1");
    expect(row?.status).toBe("delivered");
    expect(row?.channel_used).toBe("whatsapp");
    expect(row?.cost_paise).toBe(30n);

    // Verify fund daily usage cost
    const usage = await store.getDailyFundUsage(fundId, "2026-10-28");
    expect(usage.sent_count).toBe(1);
    expect(usage.total_cost_paise).toBe(30);
  });

  it("falls back to SMS when WhatsApp delivery fails, recording 15 paise cost", async () => {
    const { store, whatsapp, sms, worker } = setup();

    // Simulate WhatsApp failure
    whatsapp.shouldFail = true;
    whatsapp.failureError = "Recipient WhatsApp unregistered";

    store.outbox.set("notif-fallback", {
      id: "notif-fallback",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-2",
      idempotency_key: "idem-fallback",
      template_id: "donation_received",
      template_data: {
        fund_title: "Village Solar Fund",
        donation_id: "don-1",
        amount_paise: 10000,
      },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    const summary = await worker.processNextBatch();

    expect(summary.delivered).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(0); // Failed
    expect(sms.sentMessages).toHaveLength(1); // Delivered via SMS fallback!

    const row = store.outbox.get("notif-fallback");
    expect(row?.status).toBe("delivered");
    expect(row?.channel_used).toBe("sms");
    expect(row?.cost_paise).toBe(15n);

    const usage = await store.getDailyFundUsage(fundId, "2026-10-28");
    expect(usage.total_cost_paise).toBe(15);
  });

  it("killing worker mid-send never double-sends or drops a notification (Acceptance Criterion 1)", async () => {
    const { store, whatsapp, worker, advanceMinutes } = setup();

    store.outbox.set("notif-crash", {
      id: "notif-crash",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-crash",
      idempotency_key: "idem-crash-test",
      template_id: "approval_needed",
      template_data: {
        fund_title: "School Fund",
        expense_id: "exp-crash",
        amount_paise: 20000,
      },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    // Step 1: Worker claims row, begins processing with lease until 10:01
    const claimed = await store.claimBatch(
      10,
      new Date("2026-10-28T10:01:00.000Z"),
      new Date("2026-10-28T10:00:00.000Z"),
    );
    expect(claimed).toHaveLength(1);
    expect(store.outbox.get("notif-crash")?.status).toBe("processing");

    // Message was transmitted to provider right before crash
    await whatsapp.send({
      recipientContact: "+919876543210",
      rendered: { subject: "Test", body: "Test body", locale: "en" },
      idempotencyKey: "idem-crash-test",
      templateId: "approval_needed",
      templateData: {},
    });
    expect(whatsapp.sentMessages).toHaveLength(1);

    // SIMULATE CRASH: Worker process terminates abruptly (killed with SIGKILL).
    // The database row is left in 'processing' status with lease expiring at 10:01.

    // Immediate poll while lease is active does NOT re-claim (prevents duplicate execution)
    const midLeaseClaim = await store.claimBatch(
      10,
      new Date("2026-10-28T10:01:30.000Z"),
      new Date("2026-10-28T10:00:30.000Z"),
    );
    expect(midLeaseClaim).toHaveLength(0);

    // Step 2: Time advances past lease expiration (10:02)
    advanceMinutes(2);

    // Step 3: New worker starts up and processes pending batches
    const summary = await worker.processNextBatch();

    // Verification:
    // 1. Not dropped: row was picked up and completed
    expect(summary.claimed).toBe(1);
    expect(summary.delivered).toBe(1);

    const finalRow = store.outbox.get("notif-crash");
    expect(finalRow?.status).toBe("delivered");

    // 2. Never double-sent: provider deduplication key ensured only 1 message sent to recipient
    expect(whatsapp.sentMessages).toHaveLength(1);
  });

  it("honors opt-out on every channel (Acceptance Criterion 2)", async () => {
    const { store, whatsapp, sms, worker } = setup();

    // User opted out globally
    store.setUserPreferences({
      user_id: userId,
      whatsapp_enabled: true,
      sms_enabled: true,
      email_enabled: true,
      opted_out: true, // Opted out!
      locale: "en",
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: "UTC",
    });

    store.outbox.set("notif-optout", {
      id: "notif-optout",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-optout",
      idempotency_key: "idem-optout",
      template_id: "approval_needed",
      template_data: { fund_title: "Fund", expense_id: "exp-1", amount_paise: 100 },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    const summary = await worker.processNextBatch();

    expect(summary.skipped).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(0);
    expect(sms.sentMessages).toHaveLength(0);

    const row = store.outbox.get("notif-optout");
    expect(row?.status).toBe("skipped");
    expect(row?.last_error).toContain("opted out");
  });

  it("records per-message cost for the Cost Model (Acceptance Criterion 3)", async () => {
    const { store, worker } = setup();

    store.outbox.set("notif-cost-1", {
      id: "notif-cost-1",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-cost-1",
      idempotency_key: "idem-cost-1",
      template_id: "approval_needed",
      template_data: { fund_title: "Fund", expense_id: "exp-1", amount_paise: 100 },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    await worker.processNextBatch();

    const row = store.outbox.get("notif-cost-1");
    expect(row?.cost_paise).toBe(30n);

    const usage = await store.getDailyFundUsage(fundId, "2026-10-28");
    expect(usage.total_cost_paise).toBe(30);
  });

  it("moves notification to dead-letter queue when retries are exhausted", async () => {
    const { store, whatsapp, sms, email, worker } = setup();

    whatsapp.shouldFail = true;
    sms.shouldFail = true;
    email.shouldFail = true;

    store.outbox.set("notif-dlq", {
      id: "notif-dlq",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-dlq",
      idempotency_key: "idem-dlq",
      template_id: "approval_needed",
      template_data: { fund_title: "Fund", expense_id: "exp-1", amount_paise: 100 },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 2, // Max attempts is 3, so next failure exceeds max
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    const summary = await worker.processNextBatch();

    expect(summary.deadLettered).toBe(1);

    const row = store.outbox.get("notif-dlq");
    expect(row?.status).toBe("dead_letter");

    expect(store.deadLetters).toHaveLength(1);
    expect(store.deadLetters[0]?.notification_id).toBe("notif-dlq");
    expect(store.deadLetters[0]?.attempts).toBe(3);
  });

  it("enforces cost guard daily cap and blocks excess notifications", async () => {
    const { store, worker } = setup();

    // Set usage at cap limit
    store.fundDailyUsage.set(`${fundId}:2026-10-28`, {
      fund_id: fundId,
      usage_date: "2026-10-28",
      sent_count: 100,
      total_cost_paise: paise(3000),
      cap_count: 100,
    });

    store.outbox.set("notif-capped", {
      id: "notif-capped",
      fund_id: fundId,
      user_id: userId,
      event_id: "evt-cap",
      idempotency_key: "idem-cap",
      template_id: "approval_needed",
      template_data: { fund_title: "Fund", expense_id: "exp-1", amount_paise: 100 },
      preferred_channel: "whatsapp",
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date("2026-10-28T10:00:00.000Z"),
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: new Date("2026-10-28T10:00:00.000Z"),
      updated_at: new Date("2026-10-28T10:00:00.000Z"),
    });

    const summary = await worker.processNextBatch();

    expect(summary.failed).toBe(1);

    const row = store.outbox.get("notif-capped");
    expect(row?.status).toBe("pending");
    expect(row?.last_error).toContain("Daily notification cap (100) exceeded");
  });
});
