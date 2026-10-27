import { expect, it } from "vitest";
import { useMemoryStore } from "./server-config.js";

it("requires a database unless memory is explicitly enabled outside production", () => {
  expect(() => useMemoryStore({ NODE_ENV: "development" })).toThrow("DATABASE_URL");
  expect(useMemoryStore({ NODE_ENV: "test", YEN_ALLOW_MEMORY_STORES: "true" })).toBe(true);
  expect(useMemoryStore({ NODE_ENV: "development", DATABASE_URL: "postgres://example/db" })).toBe(
    false,
  );
  expect(() =>
    useMemoryStore({
      NODE_ENV: "production",
      YEN_ALLOW_MEMORY_STORES: "true",
      DATABASE_URL: "postgres://example/db",
    }),
  ).toThrow("YEN_ALLOW_MEMORY_STORES");
  expect(() =>
    useMemoryStore({ NODE_ENV: "development", YEN_ALLOW_MEMORY_STORES: "false" }),
  ).toThrow("DATABASE_URL");
});
