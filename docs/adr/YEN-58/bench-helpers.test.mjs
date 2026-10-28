import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  resolveBenchmarkDatabaseUrl,
  splitBenchmarkTiming,
  startAppendHammer,
} from "./bench-helpers.mjs";

test("benchmark database URL requires valid PostgreSQL URL and isolated local database", () => {
  assert.equal(
    resolveBenchmarkDatabaseUrl("postgres://postgres:pw@localhost:55432/yen_test_benchmark"),
    "postgres://postgres:pw@localhost:55432/yen_test_benchmark",
  );
  for (const url of [
    "postgres://postgres:pw@localhost:55432/postgres",
    "postgres://postgres:pw@example.com:55432/yen_test_benchmark",
    "https://example.com/yen_test_benchmark",
  ]) {
    assert.throws(() => resolveBenchmarkDatabaseUrl(url), /YEN_TEST_DATABASE_URL/);
  }
  assert.throws(() => resolveBenchmarkDatabaseUrl(undefined), /YEN_TEST_DATABASE_URL/);
});

test("Postgres benchmark refuses the shared database before connecting", () => {
  const script = new URL("./bench-postgres.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      YEN_TEST_DATABASE_URL: "postgres://postgres:pw@127.0.0.1:55432/postgres",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must point to a local database whose name starts with yen_test_/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|connect/);
});

test("verification duration excludes synthetic event generation", () => {
  assert.deepEqual(splitBenchmarkTiming(100, 35), {
    generationMs: 35,
    verificationMs: 65,
    wallMs: 100,
  });
  assert.throws(() => splitBenchmarkTiming(20, 30), /generation cannot exceed wall time/);
});

test("append hammer reports worker failures instead of returning a load count", async () => {
  let attempts = 0;
  const hammer = startAppendHammer(3, async () => {
    attempts++;
    if (attempts === 1) throw new Error("append rejected");
  });

  await assert.rejects(hammer.stop(), /1 hammer append\(s\) failed.*append rejected/);
  assert.equal(attempts, 3);
});
