import { parseDatabaseUrl } from "../../../packages/db/src/env.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveBenchmarkDatabaseUrl(raw) {
  const databaseUrl = parseDatabaseUrl(raw, "YEN_TEST_DATABASE_URL");
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!LOOPBACK_HOSTS.has(url.hostname) || !database.startsWith("yen_test_")) {
    throw new Error(
      "YEN_TEST_DATABASE_URL must point to a local database whose name starts with yen_test_.",
    );
  }
  return databaseUrl;
}

export function splitBenchmarkTiming(wallMs, generationMs) {
  const verificationMs = wallMs - generationMs;
  if (!Number.isFinite(wallMs) || !Number.isFinite(generationMs) || verificationMs < 0) {
    throw new Error("Benchmark timing must be finite and generation cannot exceed wall time.");
  }
  return {
    generationMs,
    verificationMs,
    wallMs,
  };
}

export function startAppendHammer(workerCount, append) {
  let active = true;
  let completed = 0;
  const errors = [];
  const workers = Array.from({ length: workerCount }, async () => {
    while (active) {
      try {
        await append();
        completed++;
      } catch (error) {
        errors.push(error);
        active = false;
      }
    }
  });

  return {
    async stop() {
      active = false;
      await Promise.all(workers);
      if (errors.length > 0) {
        throw new Error(
          `${errors.length} hammer append(s) failed. First error: ${errors[0].message}`,
        );
      }
      return completed;
    },
  };
}
