import { paise, parseFundId, parseUserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { InMemoryChannelProvider } from "./channels/in-memory.js";
import { InMemoryNotificationStore } from "./store.js";
import { renderNotificationTemplate } from "./templates.js";
import type { FundAlertData, NotificationLocale } from "./types.js";
import { NotificationsWorker } from "./worker.js";

const fundTitle = "Community Water Fund";
const alertTitle = "Unapproved debit";

function alertData(overrides: Partial<FundAlertData> = {}) {
  return {
    fund_title: fundTitle,
    alert_type: "unapproved_debit",
    severity: "critical",
    title: alertTitle,
    ...overrides,
  };
}

describe("fund_alert template (EN / HI, raise and escalation)", () => {
  it("renders the raise variant in English", () => {
    const rendered = renderNotificationTemplate("fund_alert", alertData(), "en");
    expect(rendered).toEqual({
      subject: "Alert (CRITICAL): Community Water Fund",
      body: "Unapproved debit for Community Water Fund. Please review.",
      locale: "en",
    });
  });

  it("renders the escalation variant in English", () => {
    const rendered = renderNotificationTemplate(
      "fund_alert",
      alertData({ variant: "escalation" }),
      "en",
    );
    expect(rendered).toEqual({
      subject: "Escalated alert (CRITICAL): Community Water Fund",
      body: "Escalated: Unapproved debit for Community Water Fund has not been acknowledged. Please review urgently.",
      locale: "en",
    });
  });

  it("renders the raise variant in Hindi", () => {
    const rendered = renderNotificationTemplate("fund_alert", alertData(), "hi");
    expect(rendered).toEqual({
      subject: "सूचना (CRITICAL): Community Water Fund",
      body: "Community Water Fund के लिए Unapproved debit। कृपया समीक्षा करें।",
      locale: "hi",
    });
  });

  it("renders the escalation variant in Hindi", () => {
    const rendered = renderNotificationTemplate(
      "fund_alert",
      alertData({ variant: "escalation" }),
      "hi",
    );
    expect(rendered).toEqual({
      subject: "सूचना बढ़ाई गई (CRITICAL): Community Water Fund",
      body: "Community Water Fund के लिए Unapproved debit की समीक्षा नहीं हुई है। कृपया तुरंत समीक्षा करें।",
      locale: "hi",
    });
  });

  it("defaults to the raise variant when no variant is given", () => {
    const withDefault = renderNotificationTemplate("fund_alert", alertData(), "en");
    const explicit = renderNotificationTemplate(
      "fund_alert",
      alertData({ variant: "raised" }),
      "en",
    );
    expect(withDefault).toEqual(explicit);
  });

  const variants = [
    ["raise", alertData()],
    ["escalation", alertData({ variant: "escalation" })],
  ] as const;
  const locales: NotificationLocale[] = ["en", "hi"];

  for (const [variantName, data] of variants) {
    for (const locale of locales) {
      it(`${variantName} (${locale}) carries no phone numbers, VPAs, names or amounts`, () => {
        // Extra keys a caller might pass must never reach the message: the schema strips them.
        const rendered = renderNotificationTemplate(
          "fund_alert",
          {
            ...data,
            owner_name: "Ananya Sharma",
            phone: "+919876543210",
            vpa: "ananya@okhdfcbank",
            amount_paise: paise(2500000),
          },
          locale,
        );
        const text = `${rendered.subject ?? ""}\n${rendered.body}`;

        expect(text).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
        expect(text).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z]+/);
        expect(text).not.toMatch(/₹|\bRs\b|\bINR\b|paise|\d[\d,]*\.\d{2}/);
        expect(text).not.toContain("Ananya");
        expect(text).not.toContain("Sharma");
        expect(text).not.toContain("25,000");
      });
    }
  }
});

describe("fund_alert consent (delivered through the notifications outbox)", () => {
  const fundResult = parseFundId("11111111-1111-7111-8111-111111111111");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const userResult = parseUserId("22222222-2222-7222-8222-222222222222");
  if (!userResult.ok) throw new Error(userResult.error);
  const fundId = fundResult.value;
  const userId = userResult.value;
  const now = new Date("2026-10-30T10:00:00.000Z");

  function setup() {
    const store = new InMemoryNotificationStore();
    const whatsapp = new InMemoryChannelProvider("whatsapp");
    const sms = new InMemoryChannelProvider("sms");
    const email = new InMemoryChannelProvider("email");
    store.setUserContact(userId, { phone: "+919876543210", email: "owner@example.com" });
    const worker = new NotificationsWorker({
      store,
      whatsappProvider: whatsapp,
      smsProvider: sms,
      emailProvider: email,
      clock: () => now,
      leaseDurationMs: 60_000,
      backoffBaseSeconds: 5,
    });
    return { store, whatsapp, worker };
  }

  function alertOutboxRow(id: string, variant: "raised" | "escalation") {
    return {
      id,
      fund_id: fundId,
      user_id: userId,
      event_id: "alert-1",
      idempotency_key: `alert:${id}`,
      template_id: "fund_alert" as const,
      template_data: alertData({ variant }),
      preferred_channel: "whatsapp" as const,
      status: "pending" as const,
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: now,
      lease_expires_at: null,
      delivered_at: null,
      channel_used: null,
      cost_paise: 0n,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
  }

  it("delivers an escalation to a user who has not withdrawn consent, using the template", async () => {
    const { store, whatsapp, worker } = setup();
    store.outbox.set("alert-escalation-ok", alertOutboxRow("alert-escalation-ok", "escalation"));

    const summary = await worker.processNextBatch();

    expect(summary.delivered).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(1);
    expect(whatsapp.sentMessages[0]?.templateId).toBe("fund_alert");
    expect(whatsapp.sentMessages[0]?.renderedBody).toBe(
      renderNotificationTemplate("fund_alert", alertData({ variant: "escalation" }), "en").body,
    );
  });

  it("skips an alert when the user has withdrawn WhatsApp consent", async () => {
    const { store, whatsapp, worker } = setup();
    store.setUserPreferences({
      user_id: userId,
      whatsapp_enabled: false,
      sms_enabled: false,
      email_enabled: true,
      opted_out: false,
      locale: "en",
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: "UTC",
    });
    store.outbox.set("alert-withdrawn", alertOutboxRow("alert-withdrawn", "escalation"));

    const summary = await worker.processNextBatch();

    expect(summary.skipped).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(0);
    expect(store.outbox.get("alert-withdrawn")?.status).toBe("skipped");
  });

  it("skips an alert when the user has opted out of all messages", async () => {
    const { store, whatsapp, worker } = setup();
    store.setUserPreferences({
      user_id: userId,
      whatsapp_enabled: true,
      sms_enabled: true,
      email_enabled: true,
      opted_out: true,
      locale: "en",
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: "UTC",
    });
    store.outbox.set("alert-opted-out", alertOutboxRow("alert-opted-out", "raised"));

    const summary = await worker.processNextBatch();

    expect(summary.skipped).toBe(1);
    expect(whatsapp.sentMessages).toHaveLength(0);
    expect(store.outbox.get("alert-opted-out")?.status).toBe("skipped");
  });
});
