import { createApp, devPolicy } from "@yen/api";
import { expect, it } from "vitest";
import { createYenClient } from "./index.js";

function client() {
  const app = createApp({
    principal: { id: "00000000-0000-4000-8000-000000000001" },
    logger: { log: () => undefined },
    policy: devPolicy,
  });
  return createYenClient({
    baseUrl: "http://yen.test",
    fetch: async (request) => app.request(request),
  });
}

it("creates, reads, and replays a fund using the generated contract", async () => {
  const api = client();
  const options = {
    params: { header: { "Idempotency-Key": "frontend-create-fund" } },
    body: { name: "Festival", targetPaise: "9007199254740993" },
  };
  const created = await api.POST("/v1/funds", options);
  expect(created.response.status).toBe(201);
  expect(created.data?.targetPaise).toBe("9007199254740993");
  if (!created.data) throw new Error("Expected created fund");
  const read = await api.GET("/v1/funds/{fundId}", {
    params: { path: { fundId: created.data.id } },
  });
  expect(read.data).toEqual(created.data);
  const replay = await api.POST("/v1/funds", options);
  expect(replay.data).toEqual(created.data);
  expect(replay.response.headers.get("idempotent-replayed")).toBe("true");
});

it("exposes typed errors and validation field paths", async () => {
  const api = client();
  const response = await api.POST("/v1/funds", {
    params: { header: { "Idempotency-Key": "invalid-input" } },
    body: { name: "", targetPaise: "-1" },
  });
  expect(response.data).toBeUndefined();
  expect(response.error?.error.code).toBe("validation_failed");
  expect(response.error?.error.details?.[0]?.path).toEqual(["json", "name"]);
});

it("gets the mock principal with no network request", async () => {
  const response = await client().GET("/v1/me");
  expect(response.data?.id).toBe("00000000-0000-4000-8000-000000000001");
});
