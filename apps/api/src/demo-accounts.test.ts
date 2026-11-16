import { serve } from "@hono/node-server";
import { seedDevDatabase } from "@yen/db";
import { getBalances, reserveForExpense } from "@yen/ledger";
import { paise } from "@yen/shared";
import { afterEach, expect, it, vi } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import {
  assertLocalDemo,
  prepareDemoAccounts,
  verifyDemoLogins,
} from "../../../scripts/demo-accounts.js";
import { createApp } from "./app.js";
import { createOtpDeliveryProvider, PostgresAuthStore } from "./auth/index.js";
import { DEV_PIN_HMAC_SECRET } from "./dependencies.js";
import { PostgresFundStore } from "./fund-store.js";
import { PostgresPinStore } from "./pin/store.js";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "production", "test"])("refuses demo PIN changes in %s", (NODE_ENV) => {
  expect(() =>
    assertLocalDemo({ NODE_ENV, DATABASE_URL: "postgres://postgres:pw@localhost/demo" }),
  ).toThrow();
});
it.each(["postgres://postgres:pw@db.example.com/demo", "https://localhost/demo"])(
  "refuses nonlocal database %s",
  (DATABASE_URL) => {
    expect(() => assertLocalDemo({ NODE_ENV: "development", DATABASE_URL })).toThrow();
  },
);

databaseSuite("repeatable demo startup and ledger balances", (sql, url) => {
  it("restores drifted and locked PINs twice, then signs all three people into the real API", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const seed = await seedDevDatabase(sql);
    const env = { NODE_ENV: "development", DATABASE_URL: url };
    await prepareDemoAccounts(sql, seed.users, env);
    await sql`UPDATE user_approval_pins SET pin_hash=${"deliberately-drifted-hash"}, status='locked_out', failed_attempts=5, total_failed_24h=10, locked_until=now()+interval '1 hour'`;
    await prepareDemoAccounts(sql, seed.users, env);
    await prepareDemoAccounts(sql, seed.users, env);
    const app = createApp({
      authStore: new PostgresAuthStore(sql),
      pinStore: new PostgresPinStore(sql),
      pinSecret: DEV_PIN_HMAC_SECRET,
      fundStore: new PostgresFundStore(sql),
      simulateOtpDelivery: true,
      otpDeliveryProvider: createOtpDeliveryProvider("development", Date.now),
    });
    const server = serve({ fetch: app.fetch, port: 0 });
    try {
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once("listening", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      await verifyDemoLogins(`http://localhost:${address.port}`, seed.users);
      const rows = await sql`SELECT status, failed_attempts FROM user_approval_pins`;
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.status === "active" && row.failed_attempts === 0)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("reads ledger holds, not the dashboard queue, and denies anonymous and nonstaff callers", async () => {
    const seed = await seedDevDatabase(sql);
    const before = await getBalances(sql, seed.fund.id);
    await sql.begin((tx) => reserveForExpense(tx, { fundId: seed.fund.id, amount: paise(10000) }));
    const options = {
      fundStore: new PostgresFundStore(sql),
      readFundBalances: (fundId: string) => getBalances(sql, fundId),
    };
    const app = createApp({ ...options, principal: { id: seed.org.ownerId, role: "owner" } });
    const response = await app.request(`/v1/funds/${seed.fund.id}/balances`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      bankPaise: before.bankPaise.toString(),
      reservedPaise: (before.pendingSpendPaise + 10000n).toString(),
      availablePaise: (before.availablePaise - 10000n).toString(),
    });
    const anonymous = createApp(options);
    expect((await anonymous.request(`/v1/funds/${seed.fund.id}/balances`)).status).toBe(401);
    const member = seed.users.find((user) => user.role === "member");
    if (!member) throw new Error("Missing member fixture");
    const memberApp = createApp({ ...options, principal: { id: member.id, role: "member" } });
    expect((await memberApp.request(`/v1/funds/${seed.fund.id}/balances`)).status).toBe(403);
  });
});
