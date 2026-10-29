import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { paise } from "@yen/shared";
import { ExotelSmsProvider } from "./exotel-sms.js";

const servers: ReturnType<typeof createServer>[] = [];
async function fakeServer(handler: (body: string, authorization: string | undefined) => { status: number; body: string }) {
  let captured = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { captured += chunk; });
    request.on("end", () => {
      const result = handler(captured, request.headers.authorization);
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(result.body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server failed to bind");
  return { endpoint: `http://127.0.0.1:${address.port}`, getBody: () => captured };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
const input = { recipientContact: "+919876543210", rendered: { body: "code {{code}}", locale: "en" as const }, idempotencyKey: "outbox-test-key", templateId: "approval_needed" as const, templateData: {} };
const config = (endpoint: string) => ({ endpoint, apiKey: "local-user", apiToken: "local-password", senderId: "TESTID", entityId: "entity-test", templateId: "template-test" });

describe("Exotel SMS contract against a local fake", () => {
  it("sends documented form fields and parses the provider SID", async () => {
    const fake = await fakeServer(() => ({ status: 200, body: JSON.stringify({ SMSMessage: { Sid: "sms-fake-1", Status: "queued" } }) }));
    const provider = new ExotelSmsProvider(config(fake.endpoint));
    expect(await provider.send(input)).toEqual({ success: true, channel: "sms", cost_paise: paise(0), provider_message_id: "sms-fake-1" });
    const fields = new URLSearchParams(fake.getBody());
    expect(fields.get("To")).toBe(input.recipientContact);
    expect(fields.get("DltEntityId")).toBe("entity-test");
    expect(fields.get("DltTemplateId")).toBe("template-test");
  });

  it("does not retry transport errors or leak recipient/message data", async () => {
    const provider = new ExotelSmsProvider(config("http://127.0.0.1:1"));
    const result = await provider.send(input);
    expect(result).toMatchObject({ success: false, retryable: false, error: "Ambiguous SMS gateway failure" });
    expect(JSON.stringify(result)).not.toContain(input.recipientContact);
    expect(JSON.stringify(result)).not.toContain("code");
  });

  it("returns safe failures for 4xx, 5xx, malformed payload and timeout-shaped abort", async () => {
    const bad = await fakeServer(() => ({ status: 400, body: "{}" }));
    expect(await new ExotelSmsProvider(config(bad.endpoint)).send(input)).toMatchObject({ success: false, retryable: false });
    const serverError = await fakeServer(() => ({ status: 503, body: "{}" }));
    expect(await new ExotelSmsProvider(config(serverError.endpoint)).send(input)).toMatchObject({ success: false, retryable: false });
    const malformed = await fakeServer(() => ({ status: 200, body: "{}" }));
    expect(await new ExotelSmsProvider(config(malformed.endpoint)).send(input)).toMatchObject({ success: false, retryable: false });
    const slow = await fakeServer(() => ({ status: 200, body: JSON.stringify({ SMSMessage: { Sid: "late" } }) }));
    const timed = await new ExotelSmsProvider({ ...config(slow.endpoint), timeoutMs: 1 }).send(input);
    expect(timed).toMatchObject({ success: false, retryable: false, error: "Ambiguous SMS gateway failure" });
  });
});
