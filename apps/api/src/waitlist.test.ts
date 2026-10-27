import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryWaitlistStore, type WaitlistStore } from "./dependencies.js";
import { serializeRequestLog } from "./logging.js";

const input = {
  name: " A ",
  contact: "Test@Example.com",
  org: " Club ",
  locale: "en",
  consent: { accepted: true, text: " Yes ", version: " 1 " },
};
const post = (value: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const silent = { log: () => undefined };

it("normalizes submissions and conceals duplicates", async () => {
  const entries: Parameters<WaitlistStore["add"]>[0][] = [];
  const memory = new MemoryWaitlistStore();
  const app = createApp({
    logger: silent,
    waitlistStore: {
      add: async (entry) => {
        entries.push(entry);
        return memory.add(entry);
      },
    },
  });
  for (const contact of [
    "Test@Example.com",
    "test@example.com",
    "+919876543210",
    "98765 43210",
    "98765-43210",
  ]) {
    const response = await app.request("/v1/waitlist", post({ ...input, contact }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "received" });
  }
  expect(
    (await createApp({ logger: silent }).request("/v1/waitlist", post({ ...input, locale: "hi" })))
      .status,
  ).toBe(201);
  expect(entries.map((e) => e.contact)).toEqual([
    "test@example.com",
    "test@example.com",
    "+919876543210",
    "+919876543210",
    "+919876543210",
  ]);
  expect(entries[0]).toMatchObject({
    name: "A",
    org: "Club",
    consentText: "Yes",
    consentVersion: "1",
  });
});

it.each([
  { ...input, contact: "bad" },
  { ...input, contact: "+91 98765 43210" },
  { ...input, contact: "1234567890" },
  { ...input, contact: "a@@example.com" },
  { ...input, contact: "a..b@example.com" },
  { ...input, contact: "a@-example.com" },
  { ...input, locale: "fr" },
  { ...input, extra: "bad" },
  { ...input, consent: { ...input.consent, accepted: false } },
  { ...input, consent: { ...input.consent, extra: true } },
])("rejects invalid input", async (value) => {
  const response = await createApp({ logger: silent }).request("/v1/waitlist", post(value));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "validation_failed", details: expect.any(Array) },
  });
});

it("enforces a separate rate limit and refills with the injected clock", async () => {
  let now = 0;
  const app = createApp({ logger: silent, clock: () => now });
  for (let i = 0; i < 5; i++)
    expect((await app.request("/v1/waitlist", post(input))).status).toBe(201);
  const limited = await app.request("/v1/waitlist", post(input));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("3600");
  now += 3600000;
  expect((await app.request("/v1/waitlist", post(input))).status).toBe(201);
});

it("rejects oversized bodies", async () => {
  const response = await createApp({ logger: silent }).request(
    "/v1/waitlist",
    post({ ...input, name: "a".repeat(9000) }),
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
});

it("never logs submitted personal data on success, validation or store failure", async () => {
  const logs: string[] = [];
  const logger = {
    log: (entry: Parameters<typeof serializeRequestLog>[0]) =>
      logs.push(serializeRequestLog(entry)),
  };
  const body = { ...input, contact: "+919876543210", org: "private@example.com" };
  await createApp({ logger }).request("/v1/waitlist", post(body));
  await createApp({ logger }).request("/v1/waitlist", post({ ...body, locale: "invalid" }));
  const failed = await createApp({
    logger,
    waitlistStore: {
      add: async () => {
        throw new Error("+919876543210 private@example.com");
      },
    },
  }).request("/v1/waitlist", post(body));
  expect(failed.status).toBe(500);
  expect(logs.join("\n")).not.toContain("+919876543210");
  expect(logs.join("\n")).not.toContain("private@example.com");
});

it.each(["/v1/waitlist", "/v1/waitlist/"])("applies waitlist middleware to %s", async (path) => {
  const app = createApp({ logger: silent, waitlistBodyLimit: 500 });
  expect((await app.request(path, post({ ...input, name: "a".repeat(600) }))).status).toBe(413);
  for (let i = 0; i < 4; i++) expect((await app.request(path, post(input))).status).toBe(201);
  expect((await app.request(path, post(input))).status).toBe(429);
});

it("rejects controls and lone surrogates while counting Unicode code points", async () => {
  const app = createApp({ logger: silent });
  for (const name of ["A\u0000B", "A\u0085B", "A\ud800B", "A\nB"]) {
    const response = await app.request("/v1/waitlist", post({ ...input, name }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        details: expect.arrayContaining([expect.objectContaining({ path: ["json", "name"] })]),
      },
    });
  }
  expect(
    (await app.request("/v1/waitlist", post({ ...input, name: "😀".repeat(200) }))).status,
  ).toBe(201);
});

it("retains an active waitlist bucket at capacity", async () => {
  let ip = "first";
  const app = createApp({ logger: silent, clock: () => 1000, clientIp: () => ip });
  for (let i = 0; i < 5; i++)
    expect((await app.request("/v1/waitlist", post(input))).status).toBe(201);
  for (let i = 0; i < 10000; i++) {
    ip = `other-${i}`;
    await app.request("/v1/waitlist", post(input));
  }
  ip = "first";
  expect((await app.request("/v1/waitlist", post(input))).status).toBe(429);
});
