import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { databaseSuite } from "./database.js";

const { describe, skip } = vi.hoisted(() => ({ describe: vi.fn(), skip: vi.fn() }));

// Observe suite registration without running hooks that create real databases.
vi.mock("vitest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vitest")>()),
  describe: Object.assign(describe, { skip }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("YEN_TEST_DATABASE_URL", undefined);
  vi.stubEnv("CI", undefined);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([undefined, "false", "0"])("skips a missing local test URL with CI=%s", (ci) => {
  vi.stubEnv("CI", ci);
  databaseSuite("environment boundary", () => {});
  expect(skip).toHaveBeenCalledOnce();
  expect(describe).not.toHaveBeenCalled();
  expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
});

it.each(["true", "1"])("fails a missing test URL in CI=%s", (ci) => {
  vi.stubEnv("CI", ci);
  expect(() => databaseSuite("environment boundary", () => {})).toThrow(
    "YEN_TEST_DATABASE_URL must point to a Postgres ADMIN connection in CI",
  );
  expect(skip).not.toHaveBeenCalled();
  expect(describe).not.toHaveBeenCalled();
});

it.each([undefined, "true", "1", "false", "0"])(
  "registers a database suite with a valid URL and CI=%s",
  (ci) => {
    vi.stubEnv("CI", ci);
    vi.stubEnv("YEN_TEST_DATABASE_URL", "postgresql://user:p%40ss@[::1]:5432/database");
    databaseSuite("environment boundary", () => {});
    expect(describe).toHaveBeenCalledOnce();
    expect(skip).not.toHaveBeenCalled();
  },
);

it.each([
  "",
  "not-a-url-private-password",
  "https://user:private-password@localhost/database",
  "postgres://",
  "postgres:///database",
  "postgres:database",
  "postgres://user:private-password@localhost:bad/database",
  "postgres://user:private-password@localhost:65536/database",
  "postgres://user:private-password%ZZ@localhost/database",
])("rejects an explicitly invalid test URL before registering a database suite: %s", (url) => {
  vi.stubEnv("YEN_TEST_DATABASE_URL", url);
  const run = () => databaseSuite("environment boundary", () => {});
  expect(run).toThrow("YEN_TEST_DATABASE_URL");
  expect(run).not.toThrow("private-password");
  expect(skip).not.toHaveBeenCalled();
  expect(describe).not.toHaveBeenCalled();
});

it.each([undefined, "postgres://localhost/database"])(
  "rejects invalid CI before skipping or registering a suite (URL=%s)",
  (url) => {
    vi.stubEnv("YEN_TEST_DATABASE_URL", url);
    vi.stubEnv("CI", "invalid-private-setting");
    const run = () => databaseSuite("environment boundary", () => {});
    expect(run).toThrow("CI must be one of: true, false, 1, 0 (or unset)");
    expect(run).not.toThrow("invalid-private-setting");
    expect(skip).not.toHaveBeenCalled();
    expect(describe).not.toHaveBeenCalled();
  },
);

it.each(["", "TRUE", "FALSE", "yes", "no", "2", " true "])(
  "rejects unsupported CI representation: %s",
  (ci) => {
    vi.stubEnv("CI", ci);
    expect(() => databaseSuite("environment boundary", () => {})).toThrow(
      "CI must be one of: true, false, 1, 0 (or unset)",
    );
    expect(skip).not.toHaveBeenCalled();
    expect(describe).not.toHaveBeenCalled();
  },
);
