import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type PartnerSignatureEnvelope,
  type PartnerStatementEntry,
  type PartnerWebhookEvent,
  partnerCreditWebhookSchema,
  partnerDebitWebhookSchema,
  partnerSignatureEnvelopeSchema,
  partnerStatementEntrySchema,
  partnerWebhookEventSchema,
  toPartnerSignatureEnvelope,
  toPartnerStatementEntry,
  toVpaVerificationResult,
  type VpaVerificationResult,
  vpaVerificationResultSchema,
} from "@yen/ledger";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { normalizePartnerWebhook } from "./partner-schema.js";
import {
  PARTNER_TIMESTAMP_TOLERANCE_MS,
  signPartnerWebhook,
  verifyPartnerWebhook,
} from "./webhook-signature.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = join(currentDir, "fixtures");
const sandboxSecret = "yen-sandbox-partner-webhook-secret-v1";

async function loadFixture(name: string): Promise<PartnerWebhookEvent> {
  const raw = JSON.parse(await readFile(join(fixturesDir, name), "utf8")) as unknown;
  // Every fixture must validate against the ledger partner webhook schemas.
  return partnerWebhookEventSchema.parse(raw);
}

function statementEntryFrom(event: PartnerWebhookEvent): PartnerStatementEntry {
  return toPartnerStatementEntry(event, `${event.data.bank_reference}`);
}

function envelopeOver(
  event: PartnerWebhookEvent,
  overrides: Partial<Parameters<typeof toPartnerSignatureEnvelope>[0]> = {},
): PartnerSignatureEnvelope {
  const rawBody = new TextEncoder().encode(JSON.stringify(event));
  const timestamp = String(Date.parse(event.timestamp) / 1000);
  return toPartnerSignatureEnvelope({
    keyId: "partner-sandbox-key-1",
    timestamp,
    signature: signPartnerWebhook(sandboxSecret, timestamp, rawBody),
    ...overrides,
  });
}

function verifyEnvelope(event: PartnerWebhookEvent, envelope: PartnerSignatureEnvelope): boolean {
  return verifyPartnerWebhook({
    secret: sandboxSecret,
    signature: envelope.signature,
    timestamp: envelope.timestamp,
    rawBody: new TextEncoder().encode(JSON.stringify(event)),
    nowMs: Date.parse(event.timestamp),
  });
}

describe("partner webhook fixtures against ledger schemas", () => {
  it("loads and validates the sanitized credit fixture", async () => {
    const event = await loadFixture("partner-credit.json");
    partnerCreditWebhookSchema.parse(event);
    expect(event.data.type).toBe("credit");
    expect(event.data.amount_paise).toBe("1250000");
    expect(event.data.utr).toBe("281024004712");
    expect(event.data.counterparty?.vpa).toBe("aarav.sharma@okhdfcbank");
  });

  it("loads and validates the sanitized debit fixture", async () => {
    const event = await loadFixture("partner-debit.json");
    partnerDebitWebhookSchema.parse(event);
    expect(event.data.type).toBe("debit");
    expect(event.data.amount_paise).toBe("487300");
    expect(event.data.utr).toBe("281024009045");
    expect(event.data.counterparty?.vpa).toBe("megha.sound@ybl");
  });

  it("rejects a credit fixture payload against the debit schema", async () => {
    const event = await loadFixture("partner-credit.json");
    expect(partnerDebitWebhookSchema.safeParse(event).success).toBe(false);
  });

  it("rejects fixtures whose amounts are not canonical integer paise", async () => {
    const event = await loadFixture("partner-credit.json");
    for (const bad of ["1250.00", "01250000", "-1250000", "1e6", "1250000.5", ""]) {
      const tampered = structuredClone(event) as PartnerWebhookEvent;
      tampered.data.amount_paise = bad;
      expect(partnerWebhookEventSchema.safeParse(tampered).success).toBe(false);
    }
  });
});

describe("partner webhook normalization into reconciliation entries", () => {
  it("normalizes the credit fixture into an integer-paise transaction", async () => {
    const event = await loadFixture("partner-credit.json");
    const tx = normalizePartnerWebhook(event);
    expect(tx.fundId).toBe("e3fb2fc4-03f9-45b1-bcef-464ab0d87ddd");
    expect(tx.bankReference).toBe("SPK281024004712");
    expect(tx.amountPaise).toBe(paise(1_250_000));
    expect(tx.type).toBe("credit");
    expect(tx.source).toBe("webhook_partner");
    expect(tx.utr).toBe("281024004712");
    expect(tx.counterpartyVpa).toBe("aarav.sharma@okhdfcbank");
    expect(Number.isSafeInteger(tx.amountPaise)).toBe(true);
  });

  it("normalizes the debit fixture into an integer-paise transaction", async () => {
    const event = await loadFixture("partner-debit.json");
    const tx = normalizePartnerWebhook(event);
    expect(tx.amountPaise).toBe(paise(487_300));
    expect(tx.type).toBe("debit");
    expect(tx.counterpartyVpa).toBe("megha.sound@ybl");
    expect(Number.isSafeInteger(tx.amountPaise)).toBe(true);
  });

  it("maps both fixtures into ledger statement entries with integer paise", async () => {
    const credit = statementEntryFrom(await loadFixture("partner-credit.json"));
    const debit = statementEntryFrom(await loadFixture("partner-debit.json"));
    partnerStatementEntrySchema.parse(credit);
    partnerStatementEntrySchema.parse(debit);
    expect(credit.amountPaise).toBe(paise(1_250_000));
    expect(debit.amountPaise).toBe(paise(487_300));
    expect(credit.direction).toBe("credit");
    expect(debit.direction).toBe("debit");
    expect(credit.source).toBe("partner_webhook");
    expect(debit.source).toBe("partner_webhook");
  });

  it("rejects statement entries carrying non-integer amounts", async () => {
    const entry = statementEntryFrom(await loadFixture("partner-credit.json"));
    expect(
      partnerStatementEntrySchema.safeParse({ ...entry, amountPaise: 1_250_000.5 }).success,
    ).toBe(false);
    expect(
      partnerStatementEntrySchema.safeParse({ ...entry, amountPaise: Number.NaN }).success,
    ).toBe(false);
  });
});

describe("partner webhook signature envelopes over fixture bodies", () => {
  it("produces envelopes that verify for both fixtures", async () => {
    for (const name of ["partner-credit.json", "partner-debit.json"]) {
      const event = await loadFixture(name);
      const envelope = envelopeOver(event);
      partnerSignatureEnvelopeSchema.parse(envelope);
      expect(verifyEnvelope(event, envelope)).toBe(true);
    }
  });

  it("binds the signature to the exact fixture bytes", async () => {
    const event = await loadFixture("partner-credit.json");
    const envelope = envelopeOver(event);
    const tampered = structuredClone(event) as PartnerWebhookEvent;
    tampered.data.amount_paise = "9999999";
    expect(verifyEnvelope(tampered, envelope)).toBe(false);
    expect(
      verifyEnvelope(event, { ...envelope, signature: `${envelope.signature.slice(0, -1)}0` }),
    ).toBe(false);
    expect(
      verifyEnvelope(event, { ...envelope, timestamp: String(Number(envelope.timestamp) + 1) }),
    ).toBe(false);
  });

  it("fails closed for the wrong secret and stale timestamps", async () => {
    const event = await loadFixture("partner-debit.json");
    const envelope = envelopeOver(event);
    expect(
      verifyPartnerWebhook({
        secret: "not-the-sandbox-secret",
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        rawBody: new TextEncoder().encode(JSON.stringify(event)),
        nowMs: Date.parse(event.timestamp),
      }),
    ).toBe(false);
    const stale = { ...envelope, timestamp: "1769417600" };
    expect(
      verifyPartnerWebhook({
        secret: sandboxSecret,
        signature: signPartnerWebhook(
          sandboxSecret,
          stale.timestamp,
          new TextEncoder().encode(JSON.stringify(event)),
        ),
        timestamp: stale.timestamp,
        rawBody: new TextEncoder().encode(JSON.stringify(event)),
        nowMs: Date.parse(event.timestamp),
      }),
    ).toBe(false);
    expect(Math.abs(Date.parse(event.timestamp) - Number(stale.timestamp) * 1000)).toBeGreaterThan(
      PARTNER_TIMESTAMP_TOLERANCE_MS,
    );
  });

  it("rejects malformed envelopes through the ledger schema", async () => {
    const event = await loadFixture("partner-credit.json");
    const envelope = envelopeOver(event);
    expect(
      partnerSignatureEnvelopeSchema.safeParse({ ...envelope, scheme: "hmac-sha256-v2" }).success,
    ).toBe(false);
    expect(
      partnerSignatureEnvelopeSchema.safeParse({
        ...envelope,
        signature: envelope.signature.toUpperCase(),
      }).success,
    ).toBe(false);
    expect(partnerSignatureEnvelopeSchema.safeParse({ ...envelope, timestamp: "-1" }).success).toBe(
      false,
    );
  });
});

describe("partner VPA verification results", () => {
  it("records a matched donor VPA from the credit fixture counterparty", async () => {
    const event = await loadFixture("partner-credit.json");
    const result: VpaVerificationResult = toVpaVerificationResult({
      vpa: event.data.counterparty?.vpa ?? "",
      status: "matched",
      registeredName: event.data.counterparty?.name ?? "",
      expectedName: "Aarav Sharma",
      verifiedAt: "2026-10-28T14:29:40.000Z",
      provider: "razorpayx-sandbox",
    });
    vpaVerificationResultSchema.parse(result);
    expect(result.status).toBe("matched");
    expect(result.registeredName).toBe("Aarav Sharma");
  });

  it("rejects a match without a registered name and fail-closed statuses without names", async () => {
    expect(() =>
      toVpaVerificationResult({
        vpa: "megha.sound@ybl",
        status: "matched",
        verifiedAt: "2026-10-28T18:44:30.000Z",
        provider: "razorpayx-sandbox",
      }),
    ).toThrow(RangeError);
    const unavailable = toVpaVerificationResult({
      vpa: "megha.sound@ybl",
      status: "unavailable",
      verifiedAt: "2026-10-28T18:44:30.000Z",
      provider: "razorpayx-sandbox",
    });
    expect(vpaVerificationResultSchema.parse(unavailable).status).toBe("unavailable");
  });
});
