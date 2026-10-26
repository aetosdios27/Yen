import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { createSql, migrate, end } = vi.hoisted(() => {
  const end = vi.fn();
  return { createSql: vi.fn(() => ({ end })), migrate: vi.fn(), end };
});

vi.mock("./client.ts", () => ({ createSql }));
vi.mock("./migrate.ts", () => ({ migrate }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", undefined);
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  "postgres://localhost",
  "postgresql://localhost/database",
  "postgres://user:private-password@localhost:5432/database?sslmode=require",
  "postgresql://user:p%40ss@[::1]:5432/database",
])("migrates with a supported DATABASE_URL: %s", async (url) => {
  vi.stubEnv("DATABASE_URL", url);
  await import("./cli.ts");
  expect(createSql).toHaveBeenCalledExactlyOnceWith(url);
  expect(migrate).toHaveBeenCalledExactlyOnceWith(createSql.mock.results[0]?.value);
  expect(end).toHaveBeenCalledOnce();
});

it.each([
  undefined,
  "",
  "not-a-url-private-password",
  "https://user:private-password@localhost/database",
  "postgres://",
  "postgres:///database",
  "postgres:database",
  "postgres://user:private-password@localhost:bad/database",
  "postgres://user:private-password@localhost:65536/database",
  "postgres://user:private-password%ZZ@localhost/database",
])("rejects missing or malformed DATABASE_URL before creating a client: %s", async (url) => {
  vi.stubEnv("DATABASE_URL", url);
  const result = import("./cli.ts");
  await expect(result).rejects.toThrow("DATABASE_URL");
  await expect(result).rejects.not.toThrow("private-password");
  expect(createSql).not.toHaveBeenCalled();
  expect(migrate).not.toHaveBeenCalled();
});
