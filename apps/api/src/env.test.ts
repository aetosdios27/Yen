import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PORT", undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("exports typed env and parses it only once per startup", async () => {
  vi.stubEnv("PORT", "3001");
  const { env } = await import("./env.js");
  expect(env).toEqual({ NODE_ENV: "test", PORT: 3001 });
  vi.stubEnv("PORT", "invalid");
  expect((await import("./env.js")).env).toBe(env);
});

it.each([undefined, "", "0", "65536", "3001.5", "invalid-private-value"])(
  "rejects missing or invalid PORT %s without exposing its value",
  async (port) => {
    vi.stubEnv("PORT", port);
    await expect(import("./env.js")).rejects.toThrow("PORT");
    await expect(import("./env.js")).rejects.not.toThrow("invalid-private-value");
  },
);

it("lists every invalid variable", async () => {
  vi.stubEnv("NODE_ENV", "invalid-private-value");
  await expect(import("./env.js")).rejects.toThrow(/NODE_ENV[\s\S]*PORT/);
  await expect(import("./env.js")).rejects.not.toThrow("invalid-private-value");
});
