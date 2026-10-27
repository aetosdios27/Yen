import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { rateLimits } from "./config.js";
import { env } from "./env.js";
import { createMockApp } from "./mock-app.js";

if (env.NODE_ENV === "production") throw new Error("Mock server is disabled in production");

process.stdout.write("Waitlist uses in-memory storage\n");

serve({
  fetch: createMockApp({
    waitlistLimit: {
      capacity: env.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: env.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    waitlistBodyLimit: env.WAITLIST_BODY_LIMIT_BYTES,
    clientIp: (context) => getConnInfo(context).remote.address ?? "unknown",
    rateLimits: rateLimits(env),
  }).fetch,
  port: env.PORT,
  hostname: "127.0.0.1",
});
