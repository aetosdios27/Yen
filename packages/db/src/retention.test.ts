import { beforeAll, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { runRetentionJob } from "./retention.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("retention job", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("reports a dry run without deleting, then purges an expired OTP challenge", async () => {
    const id = uuidv7();
    await sql`INSERT INTO auth_otps (id, phone, otp_hash, salt, channel, expires_at, resend_available_at, created_at)
      VALUES (${id}, '+919876543210', 'hash', 'salt', 'sms', now() - interval '2 days', now(), now() - interval '2 days')`;
    const dryRun = await runRetentionJob(sql, { dryRun: true });
    expect(dryRun.wouldPurge.auth_otps).toBe(1);
    expect(await sql`SELECT id FROM auth_otps WHERE id = ${id}`).toHaveLength(1);

    const result = await runRetentionJob(sql);
    expect(result.wouldPurge.auth_otps).toBe(1);
    expect(await sql`SELECT id FROM auth_otps WHERE id = ${id}`).toHaveLength(0);
    expect(await sql`SELECT count(*)::int AS count FROM fund_events`).toEqual([{ count: 0 }]);
  });
});
