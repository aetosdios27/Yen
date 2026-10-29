import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { normalizePartnerWebhook, partnerWebhookSchema } from "./partner-schema.js";

describe("Payment Partner Webhook Schema", () => {
  it("validates and normalizes valid partner webhook payload", () => {
    const raw = {
      event: "virtual_account.credited",
      timestamp: "2026-10-28T14:30:00.000Z",
      data: {
        fund_id: "e3fb2fc4-03f9-45b1-bcef-464ab0d87ddd",
        bank_reference: "TXN_PARTNER_123",
        amount_paise: 50000,
        type: "credit",
        posted_at: "2026-10-28T14:28:15.000Z",
        utr: "123456789012",
        narration: "UPI/CR/123456789012/DONOR",
        counterparty: {
          vpa: "donor@okhdfcbank",
          name: "Test Donor",
        },
      },
    };

    const parsed = normalizePartnerWebhook(raw);
    expect(parsed).toEqual({
      fundId: "e3fb2fc4-03f9-45b1-bcef-464ab0d87ddd",
      bankReference: "TXN_PARTNER_123",
      utr: "123456789012",
      amountPaise: paise(50000),
      type: "credit",
      postedAt: "2026-10-28T14:28:15.000Z",
      narration: "UPI/CR/123456789012/DONOR",
      counterpartyVpa: "donor@okhdfcbank",
      counterpartyName: "Test Donor",
      source: "webhook_partner",
      rawPayload: raw,
    });
  });

  it("rejects non-positive paise or invalid UUID", () => {
    expect(() =>
      partnerWebhookSchema.parse({
        event: "test",
        timestamp: "2026-10-28T14:30:00.000Z",
        data: {
          fund_id: "not-a-uuid",
          bank_reference: "TXN_001",
          amount_paise: -50,
          posted_at: "2026-10-28T14:30:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("accepts string amounts and rejects amounts beyond the safe integer range", () => {
    const payload = (amount: unknown) => ({
      event: "test",
      timestamp: "2026-10-28T14:30:00.000Z",
      data: {
        fund_id: "e3fb2fc4-03f9-45b1-bcef-464ab0d87ddd",
        bank_reference: "TXN_002",
        amount_paise: amount,
        posted_at: "2026-10-28T14:30:00.000Z",
      },
    });
    expect(normalizePartnerWebhook(payload("75000")).amountPaise).toBe(paise(75000));
    expect(partnerWebhookSchema.safeParse(payload("9007199254740993")).success).toBe(false);
    expect(partnerWebhookSchema.safeParse(payload("99999999999999999999")).success).toBe(false);
    expect(partnerWebhookSchema.safeParse(payload(1e300)).success).toBe(false);
    expect(partnerWebhookSchema.safeParse(payload(500.5)).success).toBe(false);
  });
});
