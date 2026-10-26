import { readFile } from "node:fs/promises";
import { z } from "@hono/zod-openapi";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { ApiError, errorCode, errorStatus } from "./errors.js";
import { MemoryIdempotencyStore } from "./stores.js";
import { devPolicy } from "./policy.js";

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
  const base = {
    principal: { id: "00000000-0000-4000-8000-000000000001" },
    idGenerator,
    clock: () => 0,
    logger: { log: () => undefined },
    policy: devPolicy,
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
  };
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const status of Object.keys(operation.responses)) {
        if (status === "200") {
          const url = path === "/v1/funds/{fundId}" ? `/v1/funds/${id}` : path;
          await check(path, method, await app.request(url));
        } else if (status === "201") {
          await check(path, method, await app.request("/v1/funds", post));
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
