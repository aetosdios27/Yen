import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ExotelSmsProvider } from "./exotel-sms.js";

const servers: ReturnType<typeof createServer>[] = [];
async function fakeServer(
  handler: (body: string, authorization: string | undefined) => { status: number; body: string },
  delayMs = 0,
) {
  let captured = "";
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      captured += chunk;
    });
    request.on("end", () => {
      const result = handler(captured, request.headers.authorization);
      setTimeout(() => {
        response.writeHead(result.status, { "content-type": "application/json" });
        response.end(result.body);
      }, delayMs);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server failed to bind");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    getBody: () => captured,
    getCalls: () => calls,
  };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
const input = {
  channel: "sms" as const,
  to: "+919876543210",
  template: "otp",
  params: { code: "123456", locale: "hi" },
  idempotencyKey: "outbox-test-key",
};
const templateNames = [
  "otp",
  "approval_needed",
  "approved_rejected",
  "donation_received",
  "objection_raised",
  "weekly_summary",
];
const config = (endpoint: string, timeoutMs?: number) => ({
  endpoint,
  apiKey: "local-user",
  apiToken: "local-password",
  senderId: "TESTID",
  entityId: "entity-test",
  statusCallbackUrl: "http://127.0.0.1:3001/v1/delivery/webhooks/exotel",
  templates: Object.fromEntries(
    templateNames.map((name) => [
      name,
      {
        templateId: { en: `${name}-en`, hi: `${name}-hi` },
        ...(name === "otp"
          ? { otpBody: { en: "Yen login code {{code}}", hi: "Yen login code {{code}}" } }
          : {}),
      },
    ]),
  ),
  ...(timeoutMs ? { timeoutMs } : {}),
});

describe("Exotel SMS contract against local fake servers", () => {
  it("sends documented DLT fields and parses the provider SID", async () => {
    const fake = await fakeServer((_, authorization) => {
      expect(authorization).toBe(
        `Basic ${Buffer.from("local-user:local-password").toString("base64")}`,
      );
      return {
        status: 200,
        body: JSON.stringify({ SMSMessage: { Sid: "sms-fake-1", Status: "queued" } }),
      };
    });
    const provider = new ExotelSmsProvider(config(fake.endpoint));
    expect(await provider.send(input)).toEqual({
      messageId: "sms-fake-1",
      status: "accepted",
      idempotencyGuaranteed: false,
    });
    const fields = new URLSearchParams(fake.getBody());
    expect(fields.get("To")).toBe(input.to);
    expect(fields.get("Body")).toBe("Yen login code 123456");
    expect(fields.get("DltEntityId")).toBe("entity-test");
    expect(fields.get("DltTemplateId")).toBe("otp-hi");
    expect(fields.get("StatusCallback")).toBe(config(fake.endpoint).statusCallbackUrl);
  });

  it.each([400, 503])("does not expose provider or recipient data on HTTP %s", async (status) => {
    const fake = await fakeServer(() => ({ status, body: "{}" }));
    await expect(new ExotelSmsProvider(config(fake.endpoint)).send(input)).rejects.toThrow(
      "SMS gateway rejected request",
    );
    expect(fake.getCalls()).toBe(1);
  });

  it("does not retry transport timeout and does not leak phone or code", async () => {
    const slow = await fakeServer(
      () => ({
        status: 200,
        body: JSON.stringify({ SMSMessage: { Sid: "late" } }),
      }),
      300,
    );
    const provider = new ExotelSmsProvider(config(slow.endpoint, 75));
    let safeError = "";
    try {
      await provider.send(input);
    } catch (error) {
      safeError = error instanceof Error ? error.message : "unknown";
    }
    expect(safeError).toBe("SMS gateway request failed");
    expect(safeError).not.toContain("+919876543210");
    expect(safeError).not.toContain("123456");
    expect(slow.getCalls()).toBe(1);
  });

  it("rejects a malformed success body without exposing its contents", async () => {
    const fake = await fakeServer(() => ({ status: 200, body: "{}" }));
    await expect(new ExotelSmsProvider(config(fake.endpoint)).send(input)).rejects.toThrow(
      "SMS gateway returned a malformed response",
    );
  });
});
