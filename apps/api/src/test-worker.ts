import { createSql } from "@yen/db";
import { createApp, devPolicy } from "./app.js";
import { PostgresIdempotencyStore, PostgresRateLimitStore } from "./stores.js";

async function main() {
  const [databaseUrl, idempotencyKey, principalId, name] = process.argv.slice(2);
  if (!databaseUrl || !idempotencyKey || !principalId || !name) {
    process.stderr.write(
      "Usage: test-worker <databaseUrl> <idempotencyKey> <principalId> <name>\n",
    );
    process.exit(1);
  }

  const sql = createSql(databaseUrl);
  try {
    const idempotencyStore = new PostgresIdempotencyStore(sql);
    const rateLimitStore = new PostgresRateLimitStore(sql);

    const app = createApp({
      idempotencyStore,
      rateLimitStore,
      principal: { id: principalId },
      policy: devPolicy,
      logger: { log: () => {} },
      clientIp: () => "127.0.0.1",
    });

    const res = await app.request("/v1/funds", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ name, targetPaise: "100" }),
    });

    const body = await res.json();
    const result = {
      pid: process.pid,
      status: res.status,
      replayed: res.headers.get("idempotent-replayed"),
      retryAfter: res.headers.get("retry-after"),
      body,
    };

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
