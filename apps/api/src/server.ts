import { serve } from "@hono/node-server";
import { createSql } from "@yen/db";
import { createApp } from "./app.js";
import { startCleanupScheduler } from "./cleanup-scheduler.js";
import { createClientIpResolver } from "./client-ip.js";
import { rateLimits } from "./config.js";
import { createDatabaseReady } from "./database-ready.js";
import { env } from "./env.js";
import { useMemoryStore } from "./server-config.js";
import {
  MemoryRateLimitStore,
  PostgresIdempotencyStore,
  PostgresRateLimitStore,
} from "./stores.js";
import { PostgresWaitlistStore } from "./waitlist-store.js";

const memory = useMemoryStore(env);
const sql = env.DATABASE_URL ? createSql(env.DATABASE_URL) : undefined;
if (memory)
  process.stderr.write(
    "WARNING: waitlist uses volatile in-memory storage; data will be lost on restart\n",
  );
const databaseUrl = env.DATABASE_URL;
const readiness = databaseUrl
  ? createDatabaseReady(
      () => createSql(databaseUrl, { max: 1, connectTimeout: 2, idleTimeout: 2 }),
      { cacheMs: env.READINESS_CACHE_MS },
    )
  : () => Promise.resolve(memory);
if (!(await readiness())) {
  await sql?.end({ timeout: 1 });
  throw new Error("DATABASE_URL connection failed or waitlist_entries table is unavailable");
}

const postgresStores = sql
  ? {
      waitlistStore: new PostgresWaitlistStore(sql),
      idempotencyStore: new PostgresIdempotencyStore(sql),
      rateLimitStore: new PostgresRateLimitStore(sql, { maxEntries: env.RATE_LIMIT_MAX_KEYS }),
    }
  : undefined;

// Memory stores reclaim expired entries themselves; only the shared Postgres tables grow.
const cleanup = postgresStores
  ? startCleanupScheduler(
      [
        {
          name: "idempotency_keys",
          run: (now, limit) => postgresStores.idempotencyStore.sweep(now, limit),
        },
        {
          name: "rate_limits",
          run: (now, limit) => postgresStores.rateLimitStore.prune(now, limit),
        },
      ],
      {
        intervalMs: env.CLEANUP_INTERVAL_MS,
        onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
      },
    )
  : undefined;

const server = serve({
  fetch: createApp({
    ...(postgresStores ?? {
      rateLimitStore: new MemoryRateLimitStore({ maxEntries: env.RATE_LIMIT_MAX_KEYS }),
    }),
    waitlistLimit: {
      capacity: env.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: env.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    readiness,
    waitlistMinResponseMs: env.WAITLIST_MIN_RESPONSE_MS,
    waitlistBodyLimit: env.WAITLIST_BODY_LIMIT_BYTES,
    clientIp: createClientIpResolver({
      trustedHops: env.TRUSTED_PROXY_HOPS,
      trustedHeader: env.TRUSTED_PROXY_HEADER,
    }),
    rateLimits: rateLimits(env),
  }).fetch,
  port: env.PORT,
});

// Graceful shutdown: stop new cleanup ticks, stop accepting connections, then release the pool.
const shutdown = async (): Promise<void> => {
  await cleanup?.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql?.end({ timeout: 5 });
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown();
  });
}
