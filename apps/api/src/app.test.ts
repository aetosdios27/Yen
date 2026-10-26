import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { fundSchema } from "./contract.js";
import type { AppDependencies } from "./dependencies.js";
import { ApiError, errorEnvelope, errorStatus } from "./errors.js";
import { type RequestLog, serializeRequestLog } from "./logging.js";
import { MemoryIdempotencyStore, MemoryRateLimitStore } from "./stores.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };
const inboundId = "00000000-0000-4000-8000-000000000099";
const input = { name: "Festival", targetPaise: "9007199254740993" };

function setup(overrides: Partial<AppDependencies> = {}) {
  let now = 0;
  let sequence = 100;
  const entries: RequestLog[] = [];
  const idGenerator = vi.fn(
    () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  );
  const app = createApp({
    principal,
    clock: () => now,
    idGenerator,
    logger: { log: (entry) => entries.push(entry) },
    ...overrides,
  });
  return {
    app,
    entries,
    idGenerator,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function post(body: unknown = input, key = "create-fund") {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  };
}

it.each(["/health", "/ready"])("serves %s without auth", async (path) => {
  const { app } = setup({ principal: null });
  const response = await app.request(path);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("x-request-id")).toBeTruthy();
});

it("runs injected readiness independently of liveness", async () => {
  const readiness = vi.fn(async () => false);
  const { app } = setup({ readiness });
  expect((await app.request("/health")).status).toBe(200);
  expect(readiness).not.toHaveBeenCalled();
  const response = await app.request("/ready");
  expect(response.status).toBe(500);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("internal");
});

it.each(Object.keys(errorStatus))("uses the error envelope for %s", async (code) => {
  const parsed = errorEnvelope.shape.error.shape.code.parse(code);
  const { app } = setup();
  app.get("/test-error", () => {
    throw new ApiError(parsed);
  });
  const response = await app.request("/test-error", { headers: { "x-request-id": inboundId } });
  const body = errorEnvelope.parse(await response.json());
  expect(response.status).toBe(errorStatus[parsed]);
  expect(body.error).toMatchObject({ code, requestId: inboundId });
  expect(response.headers.get("x-request-id")).toBe(inboundId);
});

it("hides unknown error messages, causes, and stacks", async () => {
  const { app } = setup();
  app.get("/explode", () => {
    throw new Error("secret phone +919876543210", { cause: "private" });
  });
  const response = await app.request("/explode");
  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).toContain('"code":"internal"');
  expect(body).not.toMatch(/secret|phone|919876543210|private|stack|cause/);
});

it.each([inboundId, "bad id", "919876543210", ""])(
  "echoes only a well-formed request ID %s",
  async (id) => {
    const { app } = setup();
    const response = await app.request("/health", { headers: { "x-request-id": id } });
    expect(response.headers.get("x-request-id")).toBe(
      id === inboundId ? inboundId : "00000000-0000-4000-8000-000000000100",
    );
  },
);

it("generates distinct request IDs when absent", async () => {
  const { app } = setup();
  const first = await app.request("/health");
  const second = await app.request("/health");
  expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
});

it("returns the injected principal", async () => {
  const { app } = setup();
  const response = await app.request("/v1/me");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(principal);
});

it.each(["/v1/me", "/v1/funds", "/v1/funds/not-an-id"])("requires auth for %s", async (path) => {
  const { app } = setup({ principal: null });
  const response = await app.request(path, path === "/v1/funds" ? post() : undefined);
  expect(response.status).toBe(401);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("unauthenticated");
});

it("creates and retrieves a validated stub fund with lossless money", async () => {
  const { app } = setup();
  const response = await app.request("/v1/funds", post());
  const fund = fundSchema.parse(await response.json());
  expect(response.status).toBe(201);
  expect(fund).toMatchObject({ ...input, createdAt: "1970-01-01T00:00:00.000Z" });
  const read = await app.request(`/v1/funds/${fund.id}`);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(fund);
});

it.each([
  "not-a-uuid",
  "00000000-0000-4000-8000-000000000999",
  "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
])("returns 404 for invalid or absent FundId %s", async (id) => {
  const { app } = setup();
  const response = await app.request(`/v1/funds/${id}`);
  expect(response.status).toBe(404);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("not_found");
});

it("uses the same error envelope for unknown routes", async () => {
  const { app } = setup();
  const response = await app.request("/missing");
  expect(response.status).toBe(404);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("not_found");
});

it("reports zod field paths", async () => {
  const { app } = setup();
  const response = await app.request("/v1/funds", post({ name: "", targetPaise: 1.5 }));
  expect(response.status).toBe(400);
  const body = errorEnvelope.parse(await response.json());
  expect(body.error.code).toBe("validation_failed");
  expect(body.error.details?.map((detail) => detail.path)).toEqual([
    ["json", "name"],
    ["json", "targetPaise"],
  ]);
});

it("envelopes malformed JSON", async () => {
  const { app } = setup();
  const response = await app.request("/v1/funds", { ...post(), body: "{" });
  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("validation_failed");
});

it("requires a bounded ASCII idempotency key", async () => {
  const { app } = setup();
  const response = await app.request("/v1/funds", post(input, ""));
  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.details?.[0]?.path).toEqual([
    "header",
    "Idempotency-Key",
  ]);
});

it("replays the full response without executing the handler twice", async () => {
  const { app, idGenerator, entries } = setup();
  const first = await app.request("/v1/funds", post());
  const replay = await app.request("/v1/funds", post());
  expect(replay.status).toBe(201);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect(replay.headers.get("content-type")).toBe(first.headers.get("content-type"));
  expect(await replay.text()).toBe(await first.text());
  expect(replay.headers.get("x-request-id")).not.toBe(first.headers.get("x-request-id"));
  expect(idGenerator).toHaveBeenCalledTimes(3);
  expect(entries.map((entry) => entry.route)).toEqual(["/v1/funds", "/v1/funds"]);
});

it("conflicts when a key is reused for a changed body", async () => {
  const { app } = setup();
  await app.request("/v1/funds", post());
  const response = await app.request("/v1/funds", post({ ...input, targetPaise: "1" }));
  expect(response.status).toBe(409);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("idempotency_conflict");
});

it.each(["query", "method", "content-type", "bytes"])(
  "binds idempotency to changed %s",
  async (change) => {
    const { app } = setup();
    await app.request("/v1/funds", post());
    const request = post();
    if (change === "method") request.method = "PUT";
    if (change === "content-type")
      request.headers["content-type"] = "application/json; charset=utf-8";
    if (change === "bytes") request.body = ` ${request.body}`;
    const response = await app.request(
      `/v1/funds${change === "query" ? "?different=1" : ""}`,
      request,
    );
    expect(response.status).toBe(409);
  },
);

it("isolates idempotency keys by principal", async () => {
  const idempotencyStore = new MemoryIdempotencyStore();
  const first = setup({ idempotencyStore });
  const second = setup({ idempotencyStore, principal: { id: inboundId } });
  expect((await first.app.request("/v1/funds", post())).status).toBe(201);
  const response = await second.app.request("/v1/funds", post());
  expect(response.status).toBe(201);
  expect(response.headers.get("idempotent-replayed")).toBeNull();
});

it("rejects concurrent duplicates before both can execute", async () => {
  const store = new MemoryIdempotencyStore();
  let release: (() => void) | undefined;
  let reserved: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reserved = resolve;
  });
  const { app, idGenerator } = setup({
    idempotencyStore: {
      begin: async (request) => {
        const result = await store.begin(request);
        if (result.kind === "new") {
          reserved?.();
          await gate;
        }
        return result;
      },
      complete: (request, response) => store.complete(request, response),
    },
  });
  const first = app.request("/v1/funds", post());
  await entered;
  const duplicate = await app.request("/v1/funds", post());
  expect(duplicate.status).toBe(409);
  expect(duplicate.headers.get("retry-after")).toBe("1");
  expect(errorEnvelope.parse(await duplicate.json()).error.code).toBe("idempotency_conflict");
  release?.();
  expect((await first).status).toBe(201);
  expect(idGenerator).toHaveBeenCalledTimes(3);
});

it.each(["ip", "principal"] as const)(
  "limits per %s and refills using the injected clock",
  async (limited) => {
    const limit = { capacity: 1, refillMs: 10000 };
    const large = { capacity: 100, refillMs: 10000 };
    const { app, advance } = setup({
      rateLimits: {
        ip: limited === "ip" ? limit : large,
        principal: limited === "principal" ? limit : large,
      },
    });
    expect((await app.request("/v1/me")).status).toBe(200);
    const response = await app.request("/v1/me");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("rate_limited");
    advance(10000);
    expect((await app.request("/v1/me")).status).toBe(200);
  },
);

it("does not trust forwarded IP headers", async () => {
  const { app } = setup({
    rateLimits: {
      ip: { capacity: 1, refillMs: 60000 },
      principal: { capacity: 100, refillMs: 60000 },
    },
  });
  await app.request("/v1/me", { headers: { "x-forwarded-for": "1.1.1.1" } });
  expect((await app.request("/v1/me", { headers: { "x-forwarded-for": "2.2.2.2" } })).status).toBe(
    429,
  );
});

it("isolates per-IP buckets using the server's trusted resolver", async () => {
  const rateLimitStore = new MemoryRateLimitStore();
  const limits = {
    ip: { capacity: 1, refillMs: 60000 },
    principal: { capacity: 100, refillMs: 60000 },
  };
  const first = setup({ rateLimitStore, rateLimits: limits, clientIp: () => "1.1.1.1" });
  const second = setup({ rateLimitStore, rateLimits: limits, clientIp: () => "2.2.2.2" });
  expect((await first.app.request("/v1/me")).status).toBe(200);
  expect((await second.app.request("/v1/me")).status).toBe(200);
  expect((await first.app.request("/v1/me")).status).toBe(429);
});

it("logs only allowed metadata, using a route template and no raw inputs", async () => {
  const { app, entries } = setup();
  const response = await app.request("/v1/funds/+919876543210?phone=+919876543210", {
    headers: {
      authorization: "Bearer private-token",
      cookie: "session=private-cookie",
      "Idempotency-Key": "private-key",
    },
  });
  expect(response.status).toBe(404);
  await app.request("/v1/funds", post({ ...input, name: "secret-body" }, "full-private-key"));
  const logs = entries.map(serializeRequestLog).join("\n");
  expect(logs).toContain('"route":"/v1/funds/:fundId"');
  expect(logs).not.toMatch(
    /919876543210|private-token|cookie|private-key|secret-body|authorization|Idempotency/,
  );
  expect(entries).toHaveLength(2);
  expect(Object.keys(entries[0] ?? {})).toEqual([
    "event",
    "requestId",
    "method",
    "route",
    "status",
    "durationMs",
  ]);
});

it("strips unexpected properties before JSON serialization", () => {
  const entry = {
    event: "http_request",
    requestId: inboundId,
    method: "GET",
    route: "/health",
    status: 200,
    durationMs: 0,
    authorization: "secret",
    cookie: "secret",
    body: { phone: "+919876543210" },
    "Idempotency-Key": "secret",
  } as const;
  expect(serializeRequestLog(entry)).not.toMatch(
    /secret|phone|cookie|body|Idempotency|authorization/,
  );
});

it("serves exactly the committed OpenAPI 3.1 document", async () => {
  const { app } = setup({ principal: null });
  const response = await app.request("/v1/openapi.json");
  expect(response.status).toBe(200);
  const committed = await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8");
  expect(await response.json()).toEqual(JSON.parse(committed));
  expect(JSON.parse(committed).openapi).toBe("3.1.0");
});

it("replays completed errors without re-executing a failing operation", async () => {
  const { app } = setup();
  const operation = vi.fn(() => {
    throw new Error("private failure");
  });
  app.post("/v1/failing-operation", operation);
  const first = await app.request("/v1/failing-operation", post());
  const second = await app.request("/v1/failing-operation", post());
  expect(first.status).toBe(500);
  expect(second.status).toBe(500);
  expect(second.headers.get("idempotent-replayed")).toBe("true");
  expect(await second.text()).toBe(await first.text());
  expect(operation).toHaveBeenCalledTimes(1);
});

it("keeps a reservation when response persistence fails", async () => {
  const store = new MemoryIdempotencyStore();
  const { app } = setup({
    idempotencyStore: {
      begin: (request) => store.begin(request),
      complete: async () => {
        throw new Error("private persistence failure");
      },
    },
  });
  const operation = vi.fn();
  app.post("/v1/write", (c) => {
    operation();
    return c.json({ success: true });
  });
  expect((await app.request("/v1/write", post())).status).toBe(500);
  expect((await app.request("/v1/write", post())).status).toBe(409);
  expect(operation).toHaveBeenCalledTimes(1);
});

it("replays binary response bytes and custom headers", async () => {
  const { app } = setup();
  app.post("/v1/binary", (c) => {
    c.header("content-type", "application/octet-stream");
    c.header("location", "/v1/binary/result");
    return c.body(new Uint8Array([0, 255, 128, 10]), 201);
  });
  const first = await app.request("/v1/binary", post());
  const second = await app.request("/v1/binary", post());
  expect(second.status).toBe(201);
  expect(second.headers.get("location")).toBe("/v1/binary/result");
  expect(second.headers.get("content-type")).toBe("application/octet-stream");
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(
    new Uint8Array(await first.arrayBuffer()),
  );
});

it("replays responses with no body", async () => {
  const { app } = setup();
  app.delete("/v1/empty", (c) => c.body(null, 204));
  const request = { ...post(), method: "DELETE" };
  expect((await app.request("/v1/empty", request)).status).toBe(204);
  const replay = await app.request("/v1/empty", request);
  expect(replay.status).toBe(204);
  expect(await replay.text()).toBe("");
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
});
