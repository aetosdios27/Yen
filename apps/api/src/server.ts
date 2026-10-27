import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createSql } from "@yen/db";
import { createApp } from "./app.js";
import { rateLimits } from "./config.js";
import { env } from "./env.js";
import { PostgresWaitlistStore } from "./waitlist-store.js";

const sql = env.DATABASE_URL ? createSql(env.DATABASE_URL) : undefined;
if (!sql) process.stdout.write("Waitlist uses in-memory storage\n");

serve({
  fetch: createApp({
    ...(sql ? { waitlistStore: new PostgresWaitlistStore(sql) } : {}),
    waitlistLimit: {
      capacity: env.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: env.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    waitlistMinResponseMs: env.WAITLIST_MIN_RESPONSE_MS,
    waitlistBodyLimit: env.WAITLIST_BODY_LIMIT_BYTES,
    clientIp: (context) => getConnInfo(context).remote.address ?? "unknown",
    rateLimits: rateLimits(env),
  }).fetch,
  port: env.PORT,
});
