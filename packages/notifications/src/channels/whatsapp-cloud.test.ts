import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WhatsAppCloudProvider } from "./whatsapp-cloud.js";

const servers: ReturnType<typeof createServer>[] = [];
async function fakeServer(status: number, body: string, delay = 0) {
  let captured = "";
  let authorization: string | undefined;
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    authorization = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      captured += chunk;
    });
    request.on("end", () =>
      setTimeout(() => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body);
      }, delay),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    body: () => captured,
    auth: () => authorization,
    calls: () => calls,
  };
}
afterEach(async () =>
  Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  ),
);
const request = {
  channel: "whatsapp" as const,
  to: "+919876543210",
  template: "otp",
  params: { code: "123456" },
  idempotencyKey: "test-key",
};
const config = (apiBaseUrl: string, timeoutMs = 2000) => ({
  apiBaseUrl,
  apiVersion: "v99.0",
  phoneNumberId: "local-phone-id",
  accessToken: "local-token",
  timeoutMs,
  templates: Object.fromEntries(
    [
      "otp",
      "approval_needed",
      "approved_rejected",
      "donation_received",
      "objection_raised",
      "weekly_summary",
    ].map((template) => [
      template,
      {
        name: template === "otp" ? "login_code" : template,
        language: { en: "en", hi: "hi" },
        parameters: template === "otp" ? ["code"] : [],
      },
    ]),
  ),
});

describe("WhatsApp Cloud adapter contract against local fake servers", () => {
  it("sends template JSON with bearer credentials and parses an accepted ID", async () => {
    const fake = await fakeServer(200, JSON.stringify({ messages: [{ id: "wamid.fake" }] }));
    const result = await new WhatsAppCloudProvider(config(fake.url)).send(request);
    expect(result).toEqual({
      messageId: "wamid.fake",
      status: "accepted",
      idempotencyGuaranteed: false,
    });
    expect(fake.auth()).toBe("Bearer local-token");
    const body = JSON.parse(fake.body()) as {
      messaging_product: string;
      type: string;
      template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("login_code");
    expect(body.template.components[0]?.parameters[0]?.text).toBe("123456");
  });

  it.each([400, 503])("rejects HTTP %s without retrying", async (status) => {
    const fake = await fakeServer(status, "private response");
    await expect(new WhatsAppCloudProvider(config(fake.url)).send(request)).rejects.toThrow(
      "WhatsApp provider rejected the request",
    );
    expect(fake.calls()).toBe(1);
  });

  it("treats timeout and malformed response as safe generic errors", async () => {
    const slow = await fakeServer(200, "{}", 300);
    await expect(new WhatsAppCloudProvider(config(slow.url, 75)).send(request)).rejects.toThrow();
    expect(slow.calls()).toBe(1);
    const malformed = await fakeServer(200, "not-json");
    await expect(new WhatsAppCloudProvider(config(malformed.url)).send(request)).rejects.toThrow(
      "WhatsApp provider returned a malformed response",
    );
  });
});
