import { createHash, randomBytes, randomUUID } from "node:crypto";
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

  it("binds trusted-device expiry and revocation to the backing session", async () => {
    const store = new PostgresAuthStore(sql);
    const now = Date.UTC(2026, 0, 1);
    const user = await store.findOrCreateUserByPhone(phone, now);
    expect(await sql`SELECT user_id FROM pseudonyms WHERE user_id = ${user.id}`).toEqual([]);
    const sessionId = randomUUID();
    await store.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: `trusted-device-${sessionId}`,
      userAgent: "test",
      deviceInfo: "test device",
      ipAddress: "127.0.0.1",
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    });

    await store.trustDevice(sessionId, user.id, now, 7 * 24 * 60 * 60 * 1000);
    expect(await store.getTrustedDevice(sessionId, now)).toMatchObject({
      sessionId,
      userId: user.id,
      idleExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
    expect(await store.getTrustedDevice(sessionId, now + 7 * 24 * 60 * 60 * 1000)).toMatchObject({
      idleExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    await store.trustDevice(sessionId, user.id, now + 1, 7 * 24 * 60 * 60 * 1000);
    await store.revokeSession(sessionId, now + 2);
    expect(await store.getTrustedDevice(sessionId, now + 2)).toBeNull();
  });

  it("persists phone-bound owner invites and creates a member-only lower-assurance user", async () => {
    const store = new PostgresAuthStore(sql);
    const now = Date.UTC(2026, 0, 1);
    const owner = await store.findOrCreateUserByPhone(phone, now);
    const orgId = randomUUID();
    const fundId = randomUUID();
    const inviteId = randomUUID();
    const invitePhone = normalizePhone("+919999900003");
    if (!invitePhone) throw new Error("Invalid invite test phone");
    const code = randomBytes(32).toString("hex");
    const secretHash = createHash("sha256").update(code).digest("hex");

    await sql`
      INSERT INTO orgs (id, name, legal_form, owner_id, created_at)
      VALUES (${orgId}, 'Invite test org', 'association', ${owner.id}, ${new Date(now)})
    `;
    await sql`
      INSERT INTO funds (id, org_id, title, policy_json, created_at)
      VALUES (${fundId}, ${orgId}, 'Invite test fund', ${sql.json({})}, ${new Date(now)})
    `;
    await store.createOwnerInvite({
      id: inviteId,
      fundId,
      ownerId: owner.id,
      phone: invitePhone,
      memberName: null,
      secretHash,
      expiresAt: now + 5 * 60_000,
      redeemedAt: null,
      confirmedAt: null,
      completedAt: null,
      createdAt: now,
    });

    expect(await store.redeemOwnerInvite(secretHash, phone, "Wrong number", now)).toBeNull();
    expect(await store.redeemOwnerInvite(secretHash, invitePhone, "Ramesh", now)).toMatchObject({
      memberName: "Ramesh",
      redeemedAt: now,
    });
    expect(await store.listOwnerInvites(fundId, owner.id)).toHaveLength(1);
    expect(await store.confirmOwnerInvite(inviteId, fundId, owner.id, now + 1)).toMatchObject({
      confirmedAt: now + 1,
    });
    const invitedUser = await store.completeOwnerInvite(secretHash, invitePhone, now + 2);
    expect(invitedUser).toMatchObject({
      phone: invitePhone,
      displayName: "Ramesh",
      assurance: "owner_vouched",
    });
    if (!invitedUser) throw new Error("Invite did not create a user");
    expect(
      await sql`SELECT role, status FROM memberships WHERE fund_id = ${fundId} AND user_id = ${invitedUser.id}`,
    ).toEqual([{ role: "member", status: "active" }]);
    expect(
      await sql`SELECT user_id, fund_id FROM fund_pseudonyms WHERE user_id = ${invitedUser.id} AND fund_id = ${fundId}`,
    ).toHaveLength(1);
    expect(await sql`SELECT user_id FROM pseudonyms WHERE user_id = ${invitedUser.id}`).toEqual([]);
    const persistedSecret = await sql`SELECT secret_hash FROM owner_invites WHERE id = ${inviteId}`;
    expect(persistedSecret).toEqual([{ secret_hash: secretHash }]);
    expect(JSON.stringify(persistedSecret)).not.toContain(code);
    expect(await store.completeOwnerInvite(secretHash, invitePhone, now + 3)).toBeNull();
  });
});
