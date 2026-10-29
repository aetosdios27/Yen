import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("validates at startup and exports the parsed env only once", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  await nextConfig(PHASE_PRODUCTION_SERVER);
  const { env } = await import("./env");
  expect(env).toEqual({ NEXT_PUBLIC_API_URL: "http://localhost:3001" });
  vi.stubEnv("NEXT_PUBLIC_API_URL", "invalid-private-value");
  expect((await import("./env")).env).toBe(env);
});

it.each([
  ["http://localhost:3001/", "http://localhost:3001"],
  ["http://localhost:3001///", "http://localhost:3001"],
  ["http://localhost:3001", "http://localhost:3001"],
])("normalises NEXT_PUBLIC_API_URL %s to %s", async (url, expected) => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", url);
  const { env } = await import("./env");
  expect(env.NEXT_PUBLIC_API_URL).toBe(expected);
});

it("names the variable in the startup error", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
  await expect(import("./env")).rejects.toThrow(
    "Invalid web environment:\n- NEXT_PUBLIC_API_URL: must be an absolute HTTP(S) URL",
  );
});

it.each([undefined, "", "invalid-private-value", "/api", "ftp://example.com"])(
  "fails startup for missing or invalid NEXT_PUBLIC_API_URL %s",
  async (url) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", url);
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      await expect(nextConfig(phase)).rejects.toThrow("NEXT_PUBLIC_API_URL");
      await expect(nextConfig(phase)).rejects.not.toThrow("invalid-private-value");
    }
  },
);

it("skips runtime env validation during production builds", async () => {
  const config = await nextConfig(PHASE_PRODUCTION_BUILD);
  expect(await config.generateBuildId?.()).toMatch(/^[0-9a-f]{40}$/);
});
