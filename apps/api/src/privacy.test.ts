import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { PRIVACY_NOTICE_VERSION } from "./privacy-store.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };

it("records purpose-specific consent and makes withdrawal visible immediately", async () => {
  const app = createApp({ principal, logger: { log: () => undefined } });
  const grant = await app.request("/v1/privacy/consents", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "privacy-consent-grant" },
    body: JSON.stringify({ purpose: "notification_sms", action: "grant" }),
  });
  expect(grant.status).toBe(200);
  expect(await grant.json()).toEqual({ status: "ok", noticeVersion: PRIVACY_NOTICE_VERSION });

  for (const [index, purpose] of [
    "account_otp",
    "donation_receipt_contact",
    "notification_whatsapp",
    "notification_email",
  ].entries()) {
    const response = await app.request("/v1/privacy/consents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `privacy-consent-${index}`,
      },
      body: JSON.stringify({ purpose, action: "grant" }),
    });
    expect(response.status).toBe(200);
  }

  const withdraw = await app.request("/v1/privacy/consents", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "privacy-consent-withdraw" },
    body: JSON.stringify({ purpose: "notification_sms", action: "withdraw" }),
  });
  expect(withdraw.status).toBe(200);

  const listed = await app.request("/v1/privacy/consents");
  expect(listed.status).toBe(200);
  const body = (await listed.json()) as {
    consents: Array<{ purpose: string; withdrawnAt: string | null }>;
  };
  expect(body.consents).toHaveLength(5);
  expect(body.consents.map(({ purpose }) => purpose)).toEqual(
    expect.arrayContaining([
      "account_otp",
      "donation_receipt_contact",
      "notification_whatsapp",
      "notification_sms",
      "notification_email",
    ]),
  );
  expect(body.consents.find(({ purpose }) => purpose === "notification_sms")?.withdrawnAt).toEqual(
    expect.any(String),
  );
});

it("requires authentication for consent, erasure, and retention endpoints", async () => {
  const app = createApp({ logger: { log: () => undefined } });
  for (const [path, method, body] of [
    ["/v1/privacy/consents", "GET", undefined],
    ["/v1/privacy/erasure-requests", "POST", { dryRun: true }],
    [
      "/v1/privacy/funds/00000000-0000-4000-8000-000000000002/retention-required",
      "POST",
      { userId: principal.id, reason: "Required records" },
    ],
  ] as const) {
    const response = await app.request(path, {
      method,
      ...(body
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    expect(response.status).toBe(401);
  }
});
