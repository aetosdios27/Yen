import { parseFundId, parseOrgId, parseUserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "./uuidv7.js";

describe("uuidv7", () => {
  it("encodes the current Unix milliseconds, version 7 and RFC variant", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const timestamp = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
    expect(parseFundId(id).ok).toBe(true);
    expect(parseOrgId(id).ok).toBe(true);
    expect(parseUserId(id).ok).toBe(true);
  });

  it("generates distinct IDs even in a burst", () => {
    expect(new Set(Array.from({ length: 10_000 }, () => uuidv7())).size).toBe(10_000);
  });
});
