import type { DevSeedResult, Sql } from "@yen/db";
import { z } from "zod";
import { DEV_PIN_HMAC_SECRET } from "../apps/api/src/dependencies.js";
import { generatePinSalt, hashPin, verifyPinHash } from "../apps/api/src/pin/crypto.js";
import { createYenClient } from "../packages/api-client/src/index.js";

export const DEMO_PIN = "482613";

export function assertLocalDemo(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "development") throw new Error("Demo accounts require NODE_ENV=development");
  const url = z.url().parse(env.DATABASE_URL);
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("Demo accounts require a loopback PostgreSQL database");
  }
}

export async function prepareDemoAccounts(
  sql: Sql,
  users: DevSeedResult["users"],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  assertLocalDemo(env);
  const secret = z
    .string()
    .min(1)
    .parse(env.PIN_HMAC_SECRET ?? DEV_PIN_HMAC_SECRET);
  await sql.begin(async (transaction) => {
    for (const user of users.filter((user) => user.role !== "member")) {
      await transaction`DELETE FROM auth_otp_attempt_limits WHERE phone = ${user.phone}`;
      await transaction`DELETE FROM auth_otps WHERE phone = ${user.phone}`;
      const salt = generatePinSalt();
      const pinHash = await hashPin(user.id, salt, DEMO_PIN, secret);
      const rows = await transaction`
        INSERT INTO user_approval_pins (user_id, salt, pin_hash, status)
        SELECT id, ${salt}, ${pinHash}, 'active' FROM users
        WHERE id = ${user.id} AND phone = ${user.phone}
        ON CONFLICT (user_id) DO UPDATE SET
          salt = EXCLUDED.salt, pin_hash = EXCLUDED.pin_hash, status = 'active',
          failed_attempts = 0, total_failed_24h = 0, first_failed_at = NULL,
          locked_until = NULL, cooling_off_until = NULL, updated_at = CURRENT_TIMESTAMP
        RETURNING salt, pin_hash
      `;
      const saved = z
        .object({ salt: z.string(), pin_hash: z.string() })
        .array()
        .length(1)
        .parse(rows)[0];
      if (!saved || !(await verifyPinHash(user.id, saved.salt, DEMO_PIN, saved.pin_hash, secret))) {
        throw new Error("Demo PIN verification failed");
      }
    }
  });
  return secret;
}

export async function verifyDemoLogins(
  baseUrl: string,
  users: DevSeedResult["users"],
): Promise<void> {
  const client = createYenClient({ baseUrl });
  for (const user of users.filter((user) => user.role !== "member")) {
    const sent = await client.POST("/v1/auth/otp/send", {
      body: { phone: user.phone, channel: "sms" },
    });
    if (!sent.data?.simulatedDelivery) throw new Error("Demo requires simulated OTP delivery");
    const verified = await client.POST("/v1/auth/otp/verify", {
      body: { phone: user.phone, code: sent.data.simulatedDelivery.code },
    });
    if (!verified.data) throw new Error("Demo OTP verification failed");
    const cookie = verified.response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const unlocked = await client.POST("/v1/auth/device/unlock", {
      headers: { cookie },
      body: { pin: DEMO_PIN },
    });
    if (!unlocked.data) throw new Error("Demo device unlock failed");
    const unlockedCookie = [
      cookie,
      ...unlocked.response.headers.getSetCookie().map((value) => value.split(";")[0]),
    ].join("; ");
    const funds = await client.GET("/v1/me/funds", { headers: { cookie: unlockedCookie } });
    if (
      !funds.data?.funds.some(
        (fund) => fund.role === (user.role === "treasurer" ? "owner" : "approver"),
      )
    ) {
      throw new Error("Demo fund membership verification failed");
    }
    await client.POST("/v1/auth/logout", { headers: { cookie: unlockedCookie } });
  }
}
