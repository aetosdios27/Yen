import { expect, it } from "vitest";
import { createMockApp } from "./mock-app.js";

it("provides the fixed principal to the frontend", async () => {
  const app = createMockApp({ logger: { log: () => undefined } });
  const response = await app.request("/v1/me", { headers: { Origin: "http://localhost:3000" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "00000000-0000-4000-8000-000000000001" });
  expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  expect(response.headers.get("access-control-expose-headers")).toContain("Idempotent-Replayed");
});

it("handles browser preflight with request ID and idempotency headers", async () => {
  const app = createMockApp({ logger: { log: () => undefined } });
  const response = await app.request("/v1/funds", {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type,Idempotency-Key",
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
});

it("does not allow arbitrary browser origins", async () => {
  const app = createMockApp({ logger: { log: () => undefined } });
  const response = await app.request("/v1/me", {
    headers: { Origin: "https://untrusted.example" },
  });
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});
