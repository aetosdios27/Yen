import { randomUUID } from "node:crypto";
import { migrate } from "@yen/db";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { normalizePhone } from "./auth/phone.js";
import { PostgresAuthStore } from "./auth/stores.js";

const phone = normalizePhone("+919999900001");
if (!phone) throw new Error("Invalid test phone");

databaseSuite("Postgres OTP store", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("limits verification attempts per phone across channels and concurrent requests", async () => {
    const store = new PostgresAuthStore(sql);
    const now = Date.UTC(2026, 0, 1);
    expect(await store.consumeOtpAttempt(phone, 2, now, 300_000)).toBe(true);
    expect(await store.consumeOtpAttempt(phone, 2, now + 1, 300_000)).toBe(true);
    expect(await store.consumeOtpAttempt(phone, 2, now + 2, 300_000)).toBe(false);
    expect(await store.consumeOtpAttempt(phone, 2, now + 300_001, 300_000)).toBe(true);

    const concurrentPhone = normalizePhone("+919999900002");
    if (!concurrentPhone) throw new Error("Invalid test phone");
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => store.consumeOtpAttempt(concurrentPhone, 3, now, 300_000)),
    );
    expect(attempts.filter(Boolean)).toHaveLength(3);
  });

  it("keeps one active code per number and consumes a challenge only once", async () => {
    const store = new PostgresAuthStore(sql);
    const now = Date.UTC(2026, 0, 1);
    const ids = [randomUUID(), randomUUID()];
    await Promise.all(
      ids.map((id, index) =>
        store.createOtpChallenge({
          id,
          phone,
          otpHash: `hash-${index}`,
          salt: `salt-${index}`,
          channel: index === 0 ? "whatsapp" : "sms",
          expiresAt: now + 300_000,
          resendAvailableAt: now + 60_000,
          createdAt: now,
        }),
      ),
    );
    const active = await sql`
      SELECT id FROM auth_otps
      WHERE phone = ${phone} AND consumed_at IS NULL AND expires_at > ${new Date(now)}
    `;
    expect(active).toHaveLength(1);

    const challengeId = String(active[0]?.id);
    const results = await Promise.all([
      store.consumeOtpChallenge(challengeId, now),
      store.consumeOtpChallenge(challengeId, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
