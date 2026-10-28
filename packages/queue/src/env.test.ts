import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env.js";

const DATABASE_URL = "postgres://worker:pw@127.0.0.1:5432/yen";

describe("parseWorkerEnv", () => {
  it("accepts a valid database URL and applies the documented defaults", () => {
    expect(parseWorkerEnv({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      QUEUE_SCHEMA: "pgboss",
      QUEUE_MIGRATE: false,
    });
  });

  it("names DATABASE_URL when it is missing", () => {
    expect(() => parseWorkerEnv({})).toThrow("DATABASE_URL is required");
  });

  it.each([
    "not a url",
    "mysql://worker@127.0.0.1/yen",
    "postgres://worker@/yen",
    "postgres://worker:pw@127.0.0.1:5432/yen with space",
  ])("rejects a malformed DATABASE_URL and does not echo it: %s", (value) => {
    expect(() => parseWorkerEnv({ DATABASE_URL: value })).toThrow("DATABASE_URL");
    expect(() => parseWorkerEnv({ DATABASE_URL: value })).not.toThrow(value);
  });

  it.each([
    "pgboss; DROP SCHEMA public",
    'pgboss"',
    "Upper",
    "1starts_with_digit",
    "has-dash",
    "",
    "x".repeat(64),
  ])("rejects a QUEUE_SCHEMA that is not a plain identifier: %j", (schema) => {
    expect(() => parseWorkerEnv({ DATABASE_URL, QUEUE_SCHEMA: schema })).toThrow("QUEUE_SCHEMA");
  });

  it.each(["pgboss", "_private", "yen_queue_1", "x".repeat(63)])(
    "accepts a plain identifier QUEUE_SCHEMA: %s",
    (schema) => {
      expect(parseWorkerEnv({ DATABASE_URL, QUEUE_SCHEMA: schema }).QUEUE_SCHEMA).toBe(schema);
    },
  );

  it("parses QUEUE_MIGRATE strictly as the literal strings true or false", () => {
    expect(parseWorkerEnv({ DATABASE_URL, QUEUE_MIGRATE: "true" }).QUEUE_MIGRATE).toBe(true);
    expect(parseWorkerEnv({ DATABASE_URL, QUEUE_MIGRATE: "false" }).QUEUE_MIGRATE).toBe(false);
    for (const value of ["1", "0", "TRUE", "yes", ""]) {
      expect(() => parseWorkerEnv({ DATABASE_URL, QUEUE_MIGRATE: value })).toThrow("QUEUE_MIGRATE");
    }
  });

  it("reports every invalid variable in one error", () => {
    expect(() => parseWorkerEnv({ QUEUE_SCHEMA: "bad-name", QUEUE_MIGRATE: "maybe" })).toThrow(
      /DATABASE_URL[\s\S]*QUEUE_SCHEMA[\s\S]*QUEUE_MIGRATE/,
    );
  });
});
