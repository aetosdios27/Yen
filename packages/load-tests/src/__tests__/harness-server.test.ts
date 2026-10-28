import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningHarnessServer, startHarnessServer } from "../harness-server.js";

describe("Harness Server Endpoints", () => {
  let server: RunningHarnessServer;
  const fundId = "00000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    server = await startHarnessServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves GET /health with 200 ok", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("serves GET /v1/funds/:id with fund data", async () => {
    const res = await fetch(`${server.url}/v1/funds/${fundId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(fundId);
    expect(body.name).toBe("RoboCup 2026 Asia Fund");
  });

  it("serves GET /funds/:id with public fund HTML page", async () => {
    const res = await fetch(`${server.url}/funds/${fundId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("RoboCup 2026 Asia Fund");
  });

  it("validates session on GET /v1/me", async () => {
    // Missing token
    const resMissing = await fetch(`${server.url}/v1/me`);
    expect(resMissing.status).toBe(401);

    // Invalid token
    const resInvalid = await fetch(`${server.url}/v1/me`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(resInvalid.status).toBe(401);

    // Valid token
    const resValid = await fetch(`${server.url}/v1/me`, {
      headers: { authorization: "Bearer valid-test-session" },
    });
    expect(resValid.status).toBe(200);
    const body = (await resValid.json()) as { id: string };
    expect(body.id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("handles POST /v1/funds/:id/donations/pledge with idempotency and UTR validation", async () => {
    const pledgeUrl = `${server.url}/v1/funds/${fundId}/donations/pledge`;

    // Missing idempotency key
    const resNoKey = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountPaise: "50000", utr: "123456789012" }),
    });
    expect(resNoKey.status).toBe(400);

    // Invalid paise amount
    const resBadAmount = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "k1" },
      body: JSON.stringify({ amountPaise: "not-a-number", utr: "123456789012" }),
    });
    expect(resBadAmount.status).toBe(400);

    // Invalid UTR (must be 12 digits)
    const resBadUtr = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "k2" },
      body: JSON.stringify({ amountPaise: "50000", utr: "short" }),
    });
    expect(resBadUtr.status).toBe(400);

    // Successful pledge
    const key = crypto.randomUUID();
    const utr = "987654321098";
    const resSuccess = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ amountPaise: "50000", utr, donorName: "Alice" }),
    });
    expect(resSuccess.status).toBe(201);
    const successBody = (await resSuccess.json()) as {
      donationId: string;
      fundId: string;
      status: string;
      amountPaise: string;
    };
    expect(successBody.fundId).toBe(fundId);
    expect(successBody.status).toBe("pledged");
    expect(successBody.amountPaise).toBe("50000");

    // Idempotent replay with same key and payload
    const resReplay = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ amountPaise: "50000", utr, donorName: "Alice" }),
    });
    expect(resReplay.status).toBe(201);
    expect(resReplay.headers.get("idempotent-replayed")).toBe("true");
    const replayBody = (await resReplay.json()) as { donationId: string };
    expect(replayBody.donationId).toBe(successBody.donationId);

    // Reusing claimed UTR with different key returns 409 conflict
    const resReusedUtr = await fetch(pledgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ amountPaise: "50000", utr, donorName: "Bob" }),
    });
    expect(resReusedUtr.status).toBe(409);
  });
});
