import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createSql } from "@yen/db";
import { createApp } from "./app.js";
import { rateLimits } from "./config.js";
import { env } from "./env.js";
import { useMemoryStore } from "./server-config.js";
import { PostgresWaitlistStore } from "./waitlist-store.js";

const memory = useMemoryStore(env);
const sql = env.DATABASE_URL ? createSql(env.DATABASE_URL) : undefined;
if (memory)
  process.stderr.write(
    "WARNING: waitlist uses volatile in-memory storage; data will be lost on restart\n",
  );
async function databaseReady(): Promise<boolean> {
  if (!sql) return memory;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sql`SELECT 1 FROM waitlist_entries LIMIT 0`.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
if (!(await databaseReady())) {
  await sql?.end({ timeout: 1 });
  throw new Error("DATABASE_URL connection failed or waitlist_entries table is unavailable");
}

serve({
  fetch: createApp({
    ...(sql ? { waitlistStore: new PostgresWaitlistStore(sql) } : {}),
    waitlistLimit: {
      capacity: env.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: env.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    readiness: databaseReady,
    waitlistMinResponseMs: env.WAITLIST_MIN_RESPONSE_MS,
    waitlistBodyLimit: env.WAITLIST_BODY_LIMIT_BYTES,
    clientIp: (context) => getConnInfo(context).remote.address ?? "unknown",
    rateLimits: rateLimits(env),
  }).fetch,
  port: env.PORT,
});
