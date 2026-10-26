import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "./app.js";
import { rateLimits } from "./config.js";
import { env } from "./env.js";

serve({
  fetch: createApp({
    clientIp: (context) => getConnInfo(context).remote.address ?? "unknown",
    rateLimits: rateLimits(env),
  }).fetch,
  port: env.PORT,
});
