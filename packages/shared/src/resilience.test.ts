import { describe, expect, it } from "vitest";
import { ResilientCall } from "./resilience.js";

const options = (overrides: Partial<ConstructorParameters<typeof ResilientCall>[0]> = {}) => ({
  timeoutMs: 5,
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
  failureThreshold: 2,
  resetAfterMs: 10,
  now: () => 0,
  random: () => 0,
  sleep: async () => {},
  ...overrides,
});

describe("ResilientCall", () => {
  it("times out and stops at the retry cap", async () => {
    let calls = 0;
    const client = new ResilientCall(options());
    await expect(
      client.run(async () => {
        calls++;
        return new Promise<never>(() => {});
      }),
    ).rejects.toThrow("timed out");
    expect(calls).toBe(3);
  });
  it("lets a caller avoid retrying an ambiguous write", async () => {
    let calls = 0;
    const client = new ResilientCall(options());
    await expect(
      client.run(
        async () => {
          calls++;
          throw new Error("response lost after acceptance");
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow("response lost after acceptance");
    expect(calls).toBe(1);
  });
  it("opens, half-opens after cooldown, and closes on a successful probe", async () => {
    let now = 0;
    const client = new ResilientCall(options({ now: () => now, maxAttempts: 1 }));
    const fail = () =>
      client.run(async () => {
        throw new Error("down");
      });
    await expect(fail()).rejects.toThrow("down");
    await expect(fail()).rejects.toThrow("down");
    await expect(client.run(async () => true)).rejects.toThrow("open");
    now = 10;
    await expect(client.run(async () => true)).resolves.toBe(true);
    await expect(client.run(async () => true)).resolves.toBe(true);
  });
});
