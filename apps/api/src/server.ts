import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createSql } from "@yen/db";
import { createApp } from "./app.js";
import { createOtpDeliveryProvider, PostgresAuthStore } from "./auth/index.js";
import { clientIp } from "./client-ip.js";
import { rateLimits } from "./config.js";
import { createDatabaseReady } from "./database-ready.js";
import { env } from "./env.js";
import { useMemoryStore } from "./server-config.js";
import { MemoryRateLimitStore } from "./stores.js";
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

serve({
  fetch: createApp({
    ...(sql
      ? { waitlistStore: new PostgresWaitlistStore(sql), authStore: new PostgresAuthStore(sql) }
      : {}),
    waitlistLimit: {
      capacity: env.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: env.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    readiness,
    waitlistMinResponseMs: env.WAITLIST_MIN_RESPONSE_MS,
    waitlistBodyLimit: env.WAITLIST_BODY_LIMIT_BYTES,
    clientIp: (context) =>
      clientIp(
        getConnInfo(context).remote.address ?? "unknown",
        context.req.header("x-forwarded-for"),
        env.TRUSTED_PROXY_HOPS,
      ),
    rateLimits: rateLimits(env),
    otpHashKey: env.OTP_HASH_KEY ?? "development-only-otp-hash-key-change-me",
    otpDeliveryProvider: createOtpDeliveryProvider(env.NODE_ENV),
    rateLimitStore: new MemoryRateLimitStore({ maxEntries: env.RATE_LIMIT_MAX_KEYS }),
  }).fetch,
  port: env.PORT,
});
