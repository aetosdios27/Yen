import { readFile } from "node:fs/promises";
import { z } from "@hono/zod-openapi";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { DevStubOtpDeliveryProvider, normalizePhone } from "./auth/index.js";
import { rotateSessionResponse, verifyOtpResponse } from "./contract.js";
import { ApiError, errorCode, errorStatus } from "./errors.js";
import { devPolicy } from "./policy.js";
import { MemoryIdempotencyStore } from "./stores.js";

const responseSpec = z.object({
  headers: z.record(
    z.string(),
    z.object({ schema: z.record(z.string(), z.unknown()), required: z.boolean().optional() }),
  ),
  content: z.object({
    "application/json": z.object({ schema: z.record(z.string(), z.unknown()) }),
  }),
});
const documentSpec = z.object({
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
  paths: z.record(
    z.string(),
    z.record(z.string(), z.object({ responses: z.record(z.string(), responseSpec) })),
  ),
});

it("declares retry and replay headers on their response statuses", async () => {
  const document = documentSpec.parse(
    JSON.parse(await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8")),
  );
  const responses = document.paths["/v1/funds"]?.post?.responses;
  expect(responses?.["409"]?.headers["retry-after"]).toBeDefined();
  expect(responses?.["429"]?.headers["retry-after"]).toBeDefined();
  for (const status of ["201", "400", "403", "404", "409"]) {
    expect(responses?.[status]?.headers["idempotent-replayed"], status).toBeDefined();
  }
});

it("validates every documented status and sent header against the committed OpenAPI", async () => {
  const document = documentSpec.parse(
    JSON.parse(await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8")),
  );
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat("uuid", (value: string) => z.string().uuid().safeParse(value).success);
  ajv.addFormat("date-time", (value: string) => z.iso.datetime().safeParse(value).success);
  const checkedStatuses = new Set<string>();
  const check = async (path: string, method: string, response: Response) => {
    const contract = document.paths[path]?.[method]?.responses[String(response.status)];
    expect(contract, `${method.toUpperCase()} ${path} ${response.status}`).toBeDefined();
    if (!contract) return;
    checkedStatuses.add(String(response.status));
    const validate = ajv.compile({
      ...contract.content["application/json"].schema,
      components: document.components,
    });
    const body = await response.json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    for (const [header, definition] of Object.entries(contract.headers)) {
      if (definition.required) expect(response.headers.has(header), header).toBe(true);
    }
    for (const [header, value] of response.headers) {
      if (header === "content-type" || header === "content-length") continue;
      const definition = contract.headers[header];
      expect(
        definition,
        `${method.toUpperCase()} ${path} ${response.status}: ${header}`,
      ).toBeDefined();
      if (definition) {
        const validateHeader = ajv.compile(definition.schema);
        expect(validateHeader(value), JSON.stringify(validateHeader.errors)).toBe(true);
      }
    }
  };

  let sequence = 100;
  const idGenerator = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  let currentTime = 100000;
  const clock = () => currentTime;
  const otpDeliveryProvider = new DevStubOtpDeliveryProvider(clock);
  const base = {
    principal: { id: "00000000-0000-4000-8000-000000000001" },
    idGenerator,
    clock,
    logger: { log: () => undefined },
    policy: devPolicy,
    otpDeliveryProvider,
  };
  const app = createApp(base);
  const post = {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "contract" },
    body: JSON.stringify({ name: "Festival", targetPaise: "10" }),
  };
  const created = await app.request("/v1/funds", post);
  const fund = await created.clone().json();
  await check("/v1/funds", "post", created);
  const id = z.object({ id: z.string() }).parse(fund).id;
  await check("/v1/funds/{fundId}", "get", await app.request(`/v1/funds/${id}`));
  await check("/v1/funds", "post", await app.request("/v1/funds", post));
  await check("/v1/funds", "post", await app.request("/v1/funds", { ...post, body: "{" }));
  await check(
    "/v1/funds",
    "post",
    await createApp({ ...base, principal: null }).request("/v1/funds", post),
  );
  await check("/v1/funds/{fundId}", "get", await app.request("/v1/funds/not-an-id"));

  const conflict = createApp({
    ...base,
    idempotencyStore: {
      begin: async () => ({ kind: "in_progress", requestHash: "hash" }),
      complete: async () => undefined,
      release: async () => undefined,
    },
  });
  await check("/v1/funds", "post", await conflict.request("/v1/funds", post));
  const rateLimited = createApp({
    ...base,
    rateLimits: { ip: { capacity: 1, refillMs: 1000 }, principal: { capacity: 1, refillMs: 1000 } },
  });
  await rateLimited.request("/v1/me");
  await check("/v1/me", "get", await rateLimited.request("/v1/me"));
  await check(
    "/ready",
    "get",
    await createApp({ ...base, readiness: async () => false }).request("/ready"),
  );

  for (const code of Object.keys(errorStatus)) {
    if (code === "payload_too_large") continue;
    const parsed = errorCode.parse(code);
    const errorApp = createApp(base);
    errorApp.get("/contract-error", () => {
      throw new ApiError(parsed);
    });
    const response = await errorApp.request("/contract-error");
    const matching = document.paths["/v1/me"]?.get?.responses[String(response.status)];
    expect(matching, code).toBeDefined();
    if (matching) {
      const validate = ajv.compile({
        ...matching.content["application/json"].schema,
        components: document.components,
      });
      expect(validate(await response.json()), JSON.stringify(validate.errors)).toBe(true);
      checkedStatuses.add(String(response.status));
    }
  }

  const errors = createApp({
    ...base,
    idempotencyStore: new MemoryIdempotencyStore({ clock: () => 0 }),
  });
  const invalid = {
    ...post,
    headers: { ...post.headers, "Idempotency-Key": "bad-input" },
    body: "{",
  };
  await errors.request("/v1/funds", invalid);
  await check("/v1/funds", "post", await errors.request("/v1/funds", invalid));
  const errorCodes: Record<string, string> = {
    "400": "validation_failed",
    "401": "unauthenticated",
    "403": "forbidden",
    "404": "not_found",
    "409": "conflict",
    "500": "internal",
    "504": "gateway_timeout",
  };
  const waitlistPost = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "A",
      contact: "a@example.com",
      org: "Club",
      locale: "en",
      consent: { accepted: true, text: "Yes", version: "1" },
    }),
  };
  const invalidContact = {
    ...waitlistPost,
    body: JSON.stringify({
      name: "A",
      contact: "abc",
      org: "Club",
      locale: "en",
      consent: { accepted: true, text: "Yes", version: "1" },
    }),
  };
  const invalidContactResponse = await createApp(base).request("/v1/waitlist", invalidContact);
  expect(invalidContactResponse.status).toBe(400);
  await check("/v1/waitlist", "post", invalidContactResponse);
  const waitlist = createApp({ ...base, waitlistLimit: { capacity: 2, refillMs: 3600000 } });
  await check("/v1/waitlist", "post", await waitlist.request("/v1/waitlist", waitlistPost));
  await check(
    "/v1/waitlist",
    "post",
    await waitlist.request("/v1/waitlist", { ...waitlistPost, body: "{}" }),
  );
  await check("/v1/waitlist", "post", await waitlist.request("/v1/waitlist", waitlistPost));
  await check(
    "/v1/waitlist",
    "post",
    await createApp({ ...base, waitlistBodyLimit: 1 }).request("/v1/waitlist", waitlistPost),
  );
  await check(
    "/v1/waitlist",
    "post",
    await createApp({
      ...base,
      waitlistStore: {
        add: async () => {
          throw new Error();
        },
      },
    }).request("/v1/waitlist", waitlistPost),
  );

  const parsedTestPhone = normalizePhone("+919876543210");
  if (!parsedTestPhone) throw new Error("Invalid test phone");
  const testPhone = parsedTestPhone;

  const sendRes = await app.request("/v1/auth/otp/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, channel: "whatsapp" }),
  });
  expect(sendRes.status).toBe(200);
  await check("/v1/auth/otp/send", "post", sendRes);

  const delivered = otpDeliveryProvider.getLastDeliveryFor(testPhone);
  expect(delivered).toBeDefined();

  const verifyRes = await app.request("/v1/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, code: delivered?.code ?? "" }),
  });
  expect(verifyRes.status).toBe(200);
  const authData = verifyOtpResponse.parse(await verifyRes.clone().json());
  const sessionToken = authData.session.token;
  await check("/v1/auth/otp/verify", "post", verifyRes);

  const getSessionsRes = await app.request("/v1/auth/sessions", {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  expect(getSessionsRes.status).toBe(200);
  await check("/v1/auth/sessions", "get", getSessionsRes);

  const rotateRes = await app.request("/v1/auth/session/rotate", {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  expect(rotateRes.status).toBe(200);
  const rotatedData = rotateSessionResponse.parse(await rotateRes.clone().json());
  const newSessionToken = rotatedData.session.token;
  await check("/v1/auth/session/rotate", "post", rotateRes);

  // Advance clock past cooldown to create another session
  currentTime += 70_000;
  await app.request("/v1/auth/otp/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, channel: "whatsapp" }),
  });
  const delivered2 = otpDeliveryProvider.getLastDeliveryFor(testPhone);
  const verifyRes2 = await app.request("/v1/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, code: delivered2?.code ?? "" }),
  });
  const authData2 = verifyOtpResponse.parse(await verifyRes2.json());
  const session2Id = authData2.session.id;

  // Revoke session 2 from session 1 -> 200
  const deleteSessionRes = await app.request(`/v1/auth/sessions/${session2Id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${newSessionToken}` },
  });
  expect(deleteSessionRes.status).toBe(200);
  await check("/v1/auth/sessions/{sessionId}", "delete", deleteSessionRes);

  // Revoke nonexistent session -> 404
  const delete404Res = await app.request("/v1/auth/sessions/00000000-0000-4000-8000-999999999999", {
    method: "DELETE",
    headers: { authorization: `Bearer ${newSessionToken}` },
  });
  expect(delete404Res.status).toBe(404);
  await check("/v1/auth/sessions/{sessionId}", "delete", delete404Res);

  // Advance clock again
  currentTime += 70_000;
  await app.request("/v1/auth/otp/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, channel: "whatsapp" }),
  });
  const delivered3 = otpDeliveryProvider.getLastDeliveryFor(testPhone);
  const verifyRes3 = await app.request("/v1/auth/otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: testPhone, code: delivered3?.code ?? "" }),
  });
  const authData3 = verifyOtpResponse.parse(await verifyRes3.json());
  const session3Token = authData3.session.token;

  // Logout session 3 -> 200
  const logoutRes = await app.request("/v1/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${session3Token}` },
  });
  expect(logoutRes.status).toBe(200);
  await check("/v1/auth/logout", "post", logoutRes);

  // Logout all with session 1 -> 200
  const logoutAllRes = await app.request("/v1/auth/logout-all", {
    method: "POST",
    headers: { authorization: `Bearer ${newSessionToken}` },
  });
  expect(logoutAllRes.status).toBe(200);
  await check("/v1/auth/logout-all", "post", logoutAllRes);

  for (const [path, methods] of Object.entries(document.paths)) {
    if (path === "/v1/waitlist" || path.startsWith("/v1/auth/")) continue;
    for (const [method, operation] of Object.entries(methods)) {
      for (const status of Object.keys(operation.responses)) {
        if (status === "200") {
          const url = path === "/v1/funds/{fundId}" ? `/v1/funds/${id}` : path;
          await check(path, method, await app.request(url));
        } else if (status === "201") {
          await check(path, method, await app.request("/v1/funds", post));
        } else if (status === "503") {
          await check(
            path,
            method,
            path === "/ready"
              ? await createApp({ ...base, readiness: async () => false }).request("/ready")
              : await createApp({
                  ...base,
                  rateLimitStore: {
                    consume: async () => ({
                      allowed: false,
                      overloaded: true,
                      retryAfterSeconds: 1,
                    }),
                  },
                }).request("/v1/me"),
          );
        } else if (status === "429") {
          await check(path, method, await rateLimited.request("/v1/me"));
        } else if (status === "409" && method === "post") {
          await check(path, method, await conflict.request("/v1/funds", post));
        } else {
          const code = errorCode.parse(errorCodes[status]);
          const errorApp = createApp(base);
          errorApp.get("/contract-error", () => {
            throw new ApiError(code);
          });
          await check(path, method, await errorApp.request("/contract-error"));
        }
      }
    }
  }
  const documentedStatuses = new Set(
    Object.values(document.paths).flatMap((methods) =>
      Object.values(methods).flatMap((operation) => Object.keys(operation.responses)),
    ),
  );
  expect(checkedStatuses).toEqual(documentedStatuses);
});

it("documents accepted phone spellings and rejects invalid contacts", async () => {
  const document = documentSpec.parse(
    JSON.parse(await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8")),
  );
  const validate = new Ajv2020({ strict: false }).compile(
    z.record(z.string(), z.unknown()).parse(document.components.schemas.WaitlistInput),
  );
  const input = {
    name: "A",
    org: "Club",
    locale: "en",
    consent: { accepted: true, text: "Yes", version: "1" },
  };
  expect(validate({ ...input, contact: "9876543210-" })).toBe(true);
  expect(validate({ ...input, contact: "abc" })).toBe(false);
});
