import { expect, it } from "vitest";
import { createApp } from "./app.js";

it("responds to GET /health with JSON without starting a server", async () => {
  const response = await createApp().request("/health");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ status: "ok" });
});
