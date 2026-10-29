import { randomBytes } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { runRetentionJob } from "./retention.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("retention job", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
    await sql.unsafe(`CREATE TABLE konto_staged_intents (
      id uuid PRIMARY KEY,
      intent_type text NOT NULL,
      idempotency_key text,
      payload jsonb NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz
    )`);
  });

  it("reports a dry run without deleting, then purges old OTP, session/device, invite, and rate-limit rows", async () => {
    const userId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    const sessionId = uuidv7();
    const staleDeviceSessionId = uuidv7();
    const otpId = uuidv7();
    const inviteId = uuidv7();
    const stagedIntentId = uuidv7();
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, '+919876543210', 'Member')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Club', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fund', '{}')`;
    await sql`INSERT INTO auth_otps (id, phone, otp_hash, salt, channel, expires_at, resend_available_at, created_at)
      VALUES (${otpId}, '+919876543210', 'hash', 'salt', 'sms', now() - interval '2 days', now(), now() - interval '2 days')`;
    await sql`INSERT INTO sessions (id, user_id, token_hash, created_at, last_active_at, expires_at, revoked_at)
      VALUES (${sessionId}, ${userId}, ${randomBytes(32).toString("hex")}, now() - interval '90 days', now() - interval '60 days', now() - interval '60 days', now() - interval '60 days')`;
    await sql`INSERT INTO trusted_devices (session_id, user_id, trusted_at, last_active_at, idle_expires_at, revoked_at)
      VALUES (${sessionId}, ${userId}, now() - interval '90 days', now() - interval '60 days', now() - interval '60 days', now() - interval '60 days')`;
    await sql`INSERT INTO sessions (id, user_id, token_hash, created_at, last_active_at, expires_at)
      VALUES (${staleDeviceSessionId}, ${userId}, ${randomBytes(32).toString("hex")}, now() - interval '90 days', now() - interval '60 days', now() + interval '90 days')`;
    await sql`INSERT INTO trusted_devices (session_id, user_id, trusted_at, last_active_at, idle_expires_at)
      VALUES (${staleDeviceSessionId}, ${userId}, now() - interval '90 days', now() - interval '60 days', now() - interval '60 days')`;
    await sql`INSERT INTO owner_invites (id, fund_id, owner_id, phone, secret_hash, expires_at, created_at)
      VALUES (${inviteId}, ${fundId}, ${userId}, '+919876543211', ${randomBytes(32).toString("hex")}, now() - interval '60 days', now() - interval '90 days')`;
    await sql`INSERT INTO rate_limits (key, tokens, updated_at, expires_at)
      VALUES ('expired', 0, now() - interval '2 days', now() - interval '1 day')`;
    await sql`INSERT INTO konto_staged_intents (
      id, intent_type, idempotency_key, payload, status, created_at, expires_at
    ) VALUES (
      ${stagedIntentId}, 'TRANSFER', 'stale-staged-intent', ${sql.json({ note: "old" })},
      'EXPIRED', now() - interval '90 days', now() - interval '60 days'
    )`;
    const dryRun = await runRetentionJob(sql, { dryRun: true });
    expect(dryRun.wouldPurge).toMatchObject({
      auth_otps: 1,
      sessions: 1,
      trusted_devices: 2,
      owner_invites: 1,
      rate_limits: 1,
      konto_staged_intents: 1,
    });
    expect(await sql`SELECT id FROM auth_otps WHERE id = ${otpId}`).toHaveLength(1);
    expect(
      await sql`SELECT id FROM konto_staged_intents WHERE id = ${stagedIntentId}`,
    ).toHaveLength(1);

    const result = await runRetentionJob(sql);
    expect(result.wouldPurge.auth_otps).toBe(1);
    expect(await sql`SELECT id FROM auth_otps WHERE id = ${otpId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM sessions WHERE id = ${sessionId}`).toHaveLength(0);
    expect(
      await sql`SELECT session_id FROM trusted_devices WHERE session_id = ${sessionId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT session_id FROM trusted_devices WHERE session_id = ${staleDeviceSessionId}`,
    ).toHaveLength(0);
    expect(await sql`SELECT id FROM sessions WHERE id = ${staleDeviceSessionId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM owner_invites WHERE id = ${inviteId}`).toHaveLength(0);
    expect(await sql`SELECT key FROM rate_limits WHERE key = 'expired'`).toHaveLength(0);
    expect(
      await sql`SELECT id FROM konto_staged_intents WHERE id = ${stagedIntentId}`,
    ).toHaveLength(0);
    expect(await sql`SELECT count(*)::int AS count FROM fund_events`).toEqual([{ count: 0 }]);
  });
});
