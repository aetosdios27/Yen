import {
  authOtpRowSchema,
  ownerInviteRowSchema,
  type Sql,
  sessionRowSchema,
  userRowSchema,
  uuidv7,
} from "@yen/db";
import type { PhoneE164 } from "@yen/shared";

export const TRUSTED_DEVICE_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export interface OtpChallenge {
  readonly id: string;
  readonly phone: PhoneE164;
  readonly otpHash: string;
  readonly salt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly channel: "whatsapp" | "sms";
  readonly expiresAt: number;
  readonly resendAvailableAt: number;
  readonly consumedAt: number | null;
  readonly createdAt: number;
}

export interface User {
  readonly id: string;
  readonly phone: PhoneE164;
  readonly displayName: string;
  readonly locale: string;
  readonly createdAt: number;
  readonly assurance: "otp_verified" | "owner_vouched";
}

export interface OwnerInvite {
  readonly id: string;
  readonly fundId: string;
  readonly ownerId: string;
  readonly phone: PhoneE164;
  readonly memberName: string | null;
  readonly secretHash: string;
  readonly expiresAt: number;
  readonly redeemedAt: number | null;
  readonly confirmedAt: number | null;
  readonly completedAt: number | null;
  readonly createdAt: number;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly userAgent: string;
  readonly deviceInfo: string;
  readonly ipAddress: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface TrustedDevice {
  readonly sessionId: string;
  readonly userId: string;
  readonly trustedAt: number;
  readonly lastActiveAt: number;
  readonly idleExpiresAt: number;
  readonly revokedAt: number | null;
}

export interface CreateChallengeInput {
  readonly id: string;
  readonly phone: PhoneE164;
  readonly otpHash: string;
  readonly salt: string;
  readonly channel: "whatsapp" | "sms";
  readonly expiresAt: number;
  readonly resendAvailableAt: number;
  readonly maxAttempts?: number;
  readonly createdAt: number;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly userAgent: string;
  readonly deviceInfo: string;
  readonly ipAddress: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly expiresAt: number;
}

export interface AuthStore {
  consumeOtpAttempt(
    phone: PhoneE164,
    maxAttempts: number,
    now: number,
    windowMs: number,
  ): Promise<boolean>;
  createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge>;
  getLatestActiveOtpChallenge(phone: PhoneE164, now: number): Promise<OtpChallenge | null>;
  getOtpChallengeById(challengeId: string, now: number): Promise<OtpChallenge | null>;
  incrementOtpAttempts(challengeId: string, now: number): Promise<OtpChallenge | null>;
  consumeOtpChallenge(challengeId: string, now: number): Promise<boolean>;

  findOrCreateUserByPhone(phone: PhoneE164, now: number): Promise<User>;
  getUserById(userId: string): Promise<User | null>;
  createOwnerInvite(input: OwnerInvite): Promise<void>;
  listOwnerInvites(fundId: string, ownerId: string): Promise<readonly OwnerInvite[]>;
  redeemOwnerInvite(
    secretHash: string,
    phone: PhoneE164,
    memberName: string,
    now: number,
  ): Promise<OwnerInvite | null>;
  confirmOwnerInvite(
    id: string,
    fundId: string,
    ownerId: string,
    now: number,
  ): Promise<OwnerInvite | null>;
  completeOwnerInvite(secretHash: string, phone: PhoneE164, now: number): Promise<User | null>;

  createSession(input: CreateSessionInput): Promise<Session>;
  trustDevice(sessionId: string, userId: string, now: number, idleTimeoutMs: number): Promise<void>;
  getTrustedDevice(sessionId: string, now: number): Promise<TrustedDevice | null>;
  touchTrustedDevice(sessionId: string, now: number, idleTimeoutMs: number): Promise<void>;
  lockTrustedDevice(sessionId: string, now: number): Promise<void>;
  findSessionByTokenHash(tokenHash: string, now: number): Promise<Session | null>;
  touchSession(sessionId: string, now: number): Promise<void>;
  rotateSession(sessionId: string, newTokenHash: string, now: number): Promise<Session | null>;
  revokeSession(sessionId: string, now: number): Promise<boolean>;
  revokeAllUserSessions(userId: string, now: number): Promise<number>;
  listUserSessions(userId: string, now: number): Promise<readonly Session[]>;
}

export class MemoryAuthStore implements AuthStore {
  private readonly otpAttempts = new Map<string, { startedAt: number; count: number }>();
  private readonly challenges = new Map<string, OtpChallenge>();
  private readonly users = new Map<string, User>(); // key: userId
  private readonly usersByPhone = new Map<string, string>(); // phone -> userId
  private readonly sessions = new Map<string, Session>(); // key: sessionId
  private readonly sessionTokenToId = new Map<string, string>(); // tokenHash -> sessionId
  private readonly trustedDevices = new Map<string, TrustedDevice>();
  private readonly ownerInvites = new Map<string, OwnerInvite>();

  constructor(private readonly idGenerator: () => string = () => crypto.randomUUID()) {}

  async consumeOtpAttempt(
    phone: PhoneE164,
    maxAttempts: number,
    now: number,
    windowMs: number,
  ): Promise<boolean> {
    const current = this.otpAttempts.get(phone);
    if (!current || now >= current.startedAt + windowMs) {
      this.otpAttempts.set(phone, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= maxAttempts) return false;
    this.otpAttempts.set(phone, { ...current, count: current.count + 1 });
    return true;
  }

  async createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge> {
    for (const [id, challenge] of this.challenges) {
      if (
        challenge.phone === input.phone &&
        challenge.consumedAt === null &&
        input.createdAt < challenge.expiresAt
      ) {
        this.challenges.set(id, { ...challenge, consumedAt: input.createdAt });
      }
    }
    const challenge: OtpChallenge = {
      id: input.id,
      phone: input.phone,
      otpHash: input.otpHash,
      salt: input.salt,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      channel: input.channel,
      expiresAt: input.expiresAt,
      resendAvailableAt: input.resendAvailableAt,
      consumedAt: null,
      createdAt: input.createdAt,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async getLatestActiveOtpChallenge(phone: PhoneE164, now: number): Promise<OtpChallenge | null> {
    let latest: OtpChallenge | null = null;
    for (const challenge of this.challenges.values()) {
      if (challenge.phone === phone && challenge.consumedAt === null && now < challenge.expiresAt) {
        if (!latest || challenge.createdAt > latest.createdAt) {
          latest = challenge;
        }
      }
    }
    return latest;
  }

  async getOtpChallengeById(challengeId: string, now: number): Promise<OtpChallenge | null> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.consumedAt !== null || now >= challenge.expiresAt) return null;
    return { ...challenge };
  }

  async incrementOtpAttempts(challengeId: string, now: number): Promise<OtpChallenge | null> {
    const challenge = this.challenges.get(challengeId);
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      now >= challenge.expiresAt ||
      challenge.attempts >= challenge.maxAttempts
    )
      return null;
    const updated: OtpChallenge = {
      ...challenge,
      attempts: challenge.attempts + 1,
    };
    this.challenges.set(challengeId, updated);
    return updated;
  }

  async consumeOtpChallenge(challengeId: string, now: number): Promise<boolean> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.consumedAt !== null || now >= challenge.expiresAt) return false;
    this.challenges.set(challengeId, { ...challenge, consumedAt: now });
    return true;
  }

  async findOrCreateUserByPhone(phone: PhoneE164, now: number): Promise<User> {
    const existingId = this.usersByPhone.get(phone);
    if (existingId) {
      const user = this.users.get(existingId);
      if (user) return user;
    }
    const newUser: User = {
      id: this.idGenerator(),
      phone,
      displayName: "Member",
      locale: "en",
      createdAt: now,
      assurance: "otp_verified",
    };
    this.users.set(newUser.id, newUser);
    this.usersByPhone.set(phone, newUser.id);
    return newUser;
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async createOwnerInvite(input: OwnerInvite): Promise<void> {
    this.ownerInvites.set(input.id, input);
  }

  async listOwnerInvites(fundId: string, ownerId: string): Promise<readonly OwnerInvite[]> {
    return [...this.ownerInvites.values()].filter(
      (invite) =>
        invite.fundId === fundId && invite.ownerId === ownerId && invite.completedAt === null,
    );
  }

  async redeemOwnerInvite(
    secretHash: string,
    phone: PhoneE164,
    memberName: string,
    now: number,
  ): Promise<OwnerInvite | null> {
    const invite = [...this.ownerInvites.values()].find((item) => item.secretHash === secretHash);
    if (!invite || invite.phone !== phone || now >= invite.expiresAt || invite.completedAt !== null)
      return null;
    if (invite.redeemedAt !== null) return invite;
    const updated = { ...invite, memberName, redeemedAt: now };
    this.ownerInvites.set(invite.id, updated);
    return updated;
  }

  async confirmOwnerInvite(
    id: string,
    fundId: string,
    ownerId: string,
    now: number,
  ): Promise<OwnerInvite | null> {
    const invite = this.ownerInvites.get(id);
    if (
      !invite ||
      invite.fundId !== fundId ||
      invite.ownerId !== ownerId ||
      invite.redeemedAt === null ||
      invite.completedAt !== null ||
      now >= invite.expiresAt
    )
      return null;
    const updated = { ...invite, confirmedAt: now };
    this.ownerInvites.set(id, updated);
    return updated;
  }

  async completeOwnerInvite(
    secretHash: string,
    phone: PhoneE164,
    now: number,
  ): Promise<User | null> {
    const invite = [...this.ownerInvites.values()].find((item) => item.secretHash === secretHash);
    if (
      !invite ||
      invite.phone !== phone ||
      invite.confirmedAt === null ||
      invite.completedAt !== null ||
      now >= invite.expiresAt
    )
      return null;
    if (this.usersByPhone.has(phone)) return null;
    const user: User = {
      id: this.idGenerator(),
      phone,
      displayName: invite.memberName ?? "Member",
      locale: "en",
      createdAt: now,
      assurance: "owner_vouched",
    };
    this.users.set(user.id, user);
    this.usersByPhone.set(phone, user.id);
    this.ownerInvites.set(invite.id, { ...invite, completedAt: now });
    return user;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      userAgent: input.userAgent,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
      createdAt: input.createdAt,
      lastActiveAt: input.lastActiveAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(session.id, session);
    this.sessionTokenToId.set(session.tokenHash, session.id);
    return session;
  }

  async trustDevice(sessionId: string, userId: string, now: number, idleTimeoutMs: number) {
    const existing = this.trustedDevices.get(sessionId);
    this.trustedDevices.set(sessionId, {
      sessionId,
      userId,
      trustedAt: existing?.trustedAt ?? now,
      lastActiveAt: now,
      idleExpiresAt: now + idleTimeoutMs,
      revokedAt: null,
    });
  }

  async getTrustedDevice(sessionId: string, _now: number) {
    const device = this.trustedDevices.get(sessionId);
    if (!device || device.revokedAt !== null) return null;
    return { ...device };
  }

  async touchTrustedDevice(sessionId: string, now: number, idleTimeoutMs: number) {
    const device = await this.getTrustedDevice(sessionId, now);
    if (!device || now >= device.idleExpiresAt) return;
    this.trustedDevices.set(sessionId, {
      ...device,
      lastActiveAt: now,
      idleExpiresAt: now + idleTimeoutMs,
    });
  }

  async lockTrustedDevice(sessionId: string, now: number) {
    const device = this.trustedDevices.get(sessionId);
    if (device && device.revokedAt === null) {
      this.trustedDevices.set(sessionId, { ...device, lastActiveAt: now, idleExpiresAt: now });
    }
  }

  async findSessionByTokenHash(tokenHash: string, now: number): Promise<Session | null> {
    const sessionId = this.sessionTokenToId.get(tokenHash);
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.revokedAt !== null || now >= session.expiresAt) return null;
    return session;
  }

  async touchSession(sessionId: string, now: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.revokedAt === null) {
      this.sessions.set(sessionId, {
        ...session,
        lastActiveAt: now,
      });
    }
  }

  async rotateSession(
    sessionId: string,
    newTokenHash: string,
    now: number,
  ): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt !== null || now >= session.expiresAt) return null;
    this.sessionTokenToId.delete(session.tokenHash);
    const updated: Session = {
      ...session,
      tokenHash: newTokenHash,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, updated);
    this.sessionTokenToId.set(newTokenHash, sessionId);
    return updated;
  }

  async revokeSession(sessionId: string, now: number): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt !== null) return false;
    this.sessions.set(sessionId, {
      ...session,
      revokedAt: now,
    });
    this.sessionTokenToId.delete(session.tokenHash);
    const device = this.trustedDevices.get(sessionId);
    if (device) this.trustedDevices.set(sessionId, { ...device, revokedAt: now });
    return true;
  }

  async revokeAllUserSessions(userId: string, now: number): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId && session.revokedAt === null) {
        this.sessions.set(id, {
          ...session,
          revokedAt: now,
        });
        this.sessionTokenToId.delete(session.tokenHash);
        const device = this.trustedDevices.get(id);
        if (device) this.trustedDevices.set(id, { ...device, revokedAt: now });
        count++;
      }
    }
    return count;
  }

  async listUserSessions(userId: string, now: number): Promise<readonly Session[]> {
    const list: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null && now < session.expiresAt) {
        list.push(session);
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function parseAuthOtpRow(row: unknown): OtpChallenge {
  const parsed = authOtpRowSchema.parse(row);
  return {
    id: parsed.id,
    phone: parsed.phone,
    otpHash: parsed.otp_hash,
    salt: parsed.salt,
    attempts: parsed.attempts,
    maxAttempts: parsed.max_attempts,
    channel: parsed.channel,
    expiresAt: parsed.expires_at.getTime(),
    resendAvailableAt: parsed.resend_available_at.getTime(),
    consumedAt: parsed.consumed_at ? parsed.consumed_at.getTime() : null,
    createdAt: parsed.created_at.getTime(),
  };
}

function parseSessionRow(row: unknown): Session {
  const parsed = sessionRowSchema.parse(row);
  return {
    id: parsed.id,
    userId: parsed.user_id,
    tokenHash: parsed.token_hash,
    userAgent: parsed.user_agent,
    deviceInfo: parsed.device_info,
    ipAddress: parsed.ip_address,
    createdAt: parsed.created_at.getTime(),
    lastActiveAt: parsed.last_active_at.getTime(),
    expiresAt: parsed.expires_at.getTime(),
    revokedAt: parsed.revoked_at ? parsed.revoked_at.getTime() : null,
  };
}

function parseUserRow(row: unknown): User {
  const parsed = userRowSchema.parse(row);
  return {
    id: parsed.id,
    phone: parsed.phone,
    displayName: parsed.display_name,
    locale: parsed.locale,
    createdAt: parsed.created_at.getTime(),
    assurance: parsed.assurance,
  };
}

function parseOwnerInvite(row: unknown): OwnerInvite {
  const parsed = ownerInviteRowSchema.parse(row);
  return {
    id: parsed.id,
    fundId: parsed.fund_id,
    ownerId: parsed.owner_id,
    phone: parsed.phone,
    memberName: parsed.member_name,
    secretHash: parsed.secret_hash,
    expiresAt: parsed.expires_at.getTime(),
    redeemedAt: parsed.redeemed_at?.getTime() ?? null,
    confirmedAt: parsed.confirmed_at?.getTime() ?? null,
    completedAt: parsed.completed_at?.getTime() ?? null,
    createdAt: parsed.created_at.getTime(),
  };
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly sql: Sql) {}

  async consumeOtpAttempt(
    phone: PhoneE164,
    maxAttempts: number,
    now: number,
    windowMs: number,
  ): Promise<boolean> {
    const rows = await this.sql`
      INSERT INTO auth_otp_attempt_limits (phone, attempts, window_started_at, updated_at)
      VALUES (${phone}, 1, ${new Date(now)}, ${new Date(now)})
      ON CONFLICT (phone) DO UPDATE
      SET attempts = CASE
            WHEN auth_otp_attempt_limits.window_started_at <= ${new Date(now)} - (${windowMs} * interval '1 millisecond') THEN 1
            ELSE auth_otp_attempt_limits.attempts + 1
          END,
          window_started_at = CASE
            WHEN auth_otp_attempt_limits.window_started_at <= ${new Date(now)} - (${windowMs} * interval '1 millisecond') THEN ${new Date(now)}
            ELSE auth_otp_attempt_limits.window_started_at
          END,
          updated_at = ${new Date(now)}
      WHERE auth_otp_attempt_limits.window_started_at <= ${new Date(now)} - (${windowMs} * interval '1 millisecond')
         OR auth_otp_attempt_limits.attempts < ${maxAttempts}
      RETURNING phone
    `;
    return rows.length > 0;
  }

  async createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended(${input.phone}, 0))`;
      await tx`
        UPDATE auth_otps
        SET consumed_at = ${new Date(input.createdAt)}
        WHERE phone = ${input.phone}
          AND consumed_at IS NULL
          AND expires_at > ${new Date(input.createdAt)}
      `;
      const rows = await tx`
        INSERT INTO auth_otps (
          id, phone, otp_hash, salt, attempts, max_attempts, channel,
          expires_at, resend_available_at, created_at
        ) VALUES (
          ${input.id}, ${input.phone}, ${input.otpHash}, ${input.salt}, 0,
          ${input.maxAttempts ?? 3}, ${input.channel},
          ${new Date(input.expiresAt)}, ${new Date(input.resendAvailableAt)},
          ${new Date(input.createdAt)}
        ) RETURNING *
      `;
      return parseAuthOtpRow(rows[0]);
    });
  }

  async getLatestActiveOtpChallenge(phone: PhoneE164, now: number): Promise<OtpChallenge | null> {
    const rows = await this.sql`
      SELECT * FROM auth_otps
      WHERE phone = ${phone}
        AND consumed_at IS NULL
        AND expires_at > ${new Date(now)}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows.length > 0 ? parseAuthOtpRow(rows[0]) : null;
  }

  async getOtpChallengeById(challengeId: string, now: number): Promise<OtpChallenge | null> {
    const rows = await this.sql`
      SELECT * FROM auth_otps
      WHERE id = ${challengeId} AND consumed_at IS NULL AND expires_at > ${new Date(now)}
      LIMIT 1
    `;
    return rows.length > 0 ? parseAuthOtpRow(rows[0]) : null;
  }

  async incrementOtpAttempts(challengeId: string, now: number): Promise<OtpChallenge | null> {
    const rows = await this.sql`
      UPDATE auth_otps
      SET attempts = attempts + 1
      WHERE id = ${challengeId}
        AND consumed_at IS NULL
        AND expires_at > ${new Date(now)}
        AND attempts < max_attempts
      RETURNING *
    `;
    return rows.length > 0 ? parseAuthOtpRow(rows[0]) : null;
  }

  async consumeOtpChallenge(challengeId: string, now: number): Promise<boolean> {
    const result = await this.sql`
      UPDATE auth_otps
      SET consumed_at = ${new Date(now)}
      WHERE id = ${challengeId}
        AND consumed_at IS NULL
        AND expires_at > ${new Date(now)}
    `;
    return result.count > 0;
  }

  async findOrCreateUserByPhone(phone: PhoneE164, now: number): Promise<User> {
    const existing = await this.sql`SELECT * FROM users WHERE phone = ${phone}`;
    if (existing.length > 0) {
      return parseUserRow(existing[0]);
    }
    const id = uuidv7();
    const rows = await this.sql`
      INSERT INTO users (id, phone, display_name, locale, created_at)
      VALUES (${id}, ${phone}, 'Member', 'en', ${new Date(now)})
      ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
      RETURNING *
    `;
    const user = parseUserRow(rows[0]);
    return user;
  }

  async getUserById(userId: string): Promise<User | null> {
    const rows = await this.sql`SELECT * FROM users WHERE id = ${userId}`;
    return rows.length > 0 ? parseUserRow(rows[0]) : null;
  }

  async createOwnerInvite(input: OwnerInvite): Promise<void> {
    await this.sql`
      INSERT INTO owner_invites (id, fund_id, owner_id, phone, secret_hash, expires_at, created_at)
      VALUES (${input.id}, ${input.fundId}, ${input.ownerId}, ${input.phone}, ${input.secretHash}, ${new Date(input.expiresAt)}, ${new Date(input.createdAt)})
    `;
  }

  async listOwnerInvites(fundId: string, ownerId: string): Promise<readonly OwnerInvite[]> {
    const rows = await this.sql`
      SELECT * FROM owner_invites WHERE fund_id = ${fundId} AND owner_id = ${ownerId}
        AND completed_at IS NULL ORDER BY created_at DESC
    `;
    return rows.map(parseOwnerInvite);
  }

  async redeemOwnerInvite(
    secretHash: string,
    phone: PhoneE164,
    memberName: string,
    now: number,
  ): Promise<OwnerInvite | null> {
    const rows = await this.sql`
      UPDATE owner_invites SET member_name = COALESCE(member_name, ${memberName}), redeemed_at = COALESCE(redeemed_at, ${new Date(now)})
      WHERE secret_hash = ${secretHash} AND phone = ${phone} AND expires_at > ${new Date(now)}
        AND completed_at IS NULL
      RETURNING *
    `;
    return rows.length ? parseOwnerInvite(rows[0]) : null;
  }

  async confirmOwnerInvite(
    id: string,
    fundId: string,
    ownerId: string,
    now: number,
  ): Promise<OwnerInvite | null> {
    const rows = await this.sql`
      UPDATE owner_invites SET confirmed_at = ${new Date(now)}
      WHERE id = ${id} AND fund_id = ${fundId} AND owner_id = ${ownerId}
        AND redeemed_at IS NOT NULL AND confirmed_at IS NULL AND completed_at IS NULL
        AND expires_at > ${new Date(now)}
      RETURNING *
    `;
    return rows.length ? parseOwnerInvite(rows[0]) : null;
  }

  async completeOwnerInvite(
    secretHash: string,
    phone: PhoneE164,
    now: number,
  ): Promise<User | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT * FROM owner_invites WHERE secret_hash = ${secretHash} AND phone = ${phone}
          AND confirmed_at IS NOT NULL AND completed_at IS NULL AND expires_at > ${new Date(now)}
          FOR UPDATE
      `;
      if (!rows.length) return null;
      const invite = parseOwnerInvite(rows[0]);
      const userId = uuidv7();
      const created = await tx`
        INSERT INTO users (id, phone, display_name, locale, assurance, created_at)
        VALUES (${userId}, ${phone}, ${invite.memberName ?? "Member"}, 'en', 'owner_vouched', ${new Date(now)})
        ON CONFLICT (phone) DO NOTHING RETURNING *
      `;
      if (!created.length) return null;
      await tx`
        INSERT INTO memberships (fund_id, user_id, role, status, created_at)
        VALUES (${invite.fundId}, ${userId}, 'member', 'active', ${new Date(now)})
        ON CONFLICT DO NOTHING
      `;
      await tx`
        INSERT INTO fund_pseudonyms (pseudonym_id, user_id, fund_id)
        VALUES (gen_random_uuid(), ${userId}, ${invite.fundId})
        ON CONFLICT (user_id, fund_id) DO NOTHING
      `;
      await tx`UPDATE owner_invites SET completed_at = ${new Date(now)} WHERE id = ${invite.id}`;
      return parseUserRow(created[0]);
    });
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const rows = await this.sql`
      INSERT INTO sessions (
        id, user_id, token_hash, user_agent, device_info, ip_address,
        created_at, last_active_at, expires_at
      ) VALUES (
        ${input.id}, ${input.userId}, ${input.tokenHash}, ${input.userAgent},
        ${input.deviceInfo}, ${input.ipAddress}, ${new Date(input.createdAt)},
        ${new Date(input.lastActiveAt)}, ${new Date(input.expiresAt)}
      ) RETURNING *
    `;
    return parseSessionRow(rows[0]);
  }

  async trustDevice(sessionId: string, userId: string, now: number, idleTimeoutMs: number) {
    await this.sql`
      INSERT INTO trusted_devices (session_id, user_id, trusted_at, last_active_at, idle_expires_at)
      SELECT ${sessionId}, ${userId}, ${new Date(now)}, ${new Date(now)}, ${new Date(now + idleTimeoutMs)}
      WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL)
      ON CONFLICT (session_id) DO UPDATE
      SET last_active_at = EXCLUDED.last_active_at,
          idle_expires_at = EXCLUDED.idle_expires_at,
          revoked_at = NULL
      WHERE trusted_devices.user_id = EXCLUDED.user_id
    `;
  }

  async getTrustedDevice(sessionId: string, now: number): Promise<TrustedDevice | null> {
    const rows = await this.sql`
      SELECT trusted_devices.session_id, trusted_devices.user_id,
        trusted_devices.trusted_at, trusted_devices.last_active_at,
        trusted_devices.idle_expires_at, trusted_devices.revoked_at
      FROM trusted_devices
      JOIN sessions ON sessions.id = trusted_devices.session_id
        AND sessions.user_id = trusted_devices.user_id
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ${new Date(now)}
      WHERE trusted_devices.session_id = ${sessionId}
        AND trusted_devices.revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: String(row.session_id),
      userId: String(row.user_id),
      trustedAt: new Date(String(row.trusted_at)).getTime(),
      lastActiveAt: new Date(String(row.last_active_at)).getTime(),
      idleExpiresAt: new Date(String(row.idle_expires_at)).getTime(),
      revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).getTime() : null,
    };
  }

  async touchTrustedDevice(sessionId: string, now: number, idleTimeoutMs: number) {
    await this.sql`
      UPDATE trusted_devices
      SET last_active_at = ${new Date(now)}, idle_expires_at = ${new Date(now + idleTimeoutMs)}
      WHERE session_id = ${sessionId} AND revoked_at IS NULL AND idle_expires_at > ${new Date(now)}
    `;
  }

  async lockTrustedDevice(sessionId: string, now: number) {
    await this.sql`
      UPDATE trusted_devices
      SET last_active_at = ${new Date(now)}, idle_expires_at = ${new Date(now)}
      WHERE session_id = ${sessionId} AND revoked_at IS NULL
    `;
  }

  async findSessionByTokenHash(tokenHash: string, now: number): Promise<Session | null> {
    const rows = await this.sql`
      SELECT * FROM sessions
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
        AND expires_at > ${new Date(now)}
      LIMIT 1
    `;
    return rows.length > 0 ? parseSessionRow(rows[0]) : null;
  }

  async touchSession(sessionId: string, now: number): Promise<void> {
    await this.sql`
      UPDATE sessions
      SET last_active_at = ${new Date(now)}
      WHERE id = ${sessionId} AND revoked_at IS NULL
    `;
  }

  async rotateSession(
    sessionId: string,
    newTokenHash: string,
    now: number,
  ): Promise<Session | null> {
    const rows = await this.sql`
      UPDATE sessions
      SET token_hash = ${newTokenHash},
          last_active_at = ${new Date(now)}
      WHERE id = ${sessionId} AND revoked_at IS NULL AND expires_at > ${new Date(now)}
      RETURNING *
    `;
    return rows.length > 0 ? parseSessionRow(rows[0]) : null;
  }

  async revokeSession(sessionId: string, now: number): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const result = await tx`
        UPDATE sessions SET revoked_at = ${new Date(now)}
        WHERE id = ${sessionId} AND revoked_at IS NULL
      `;
      await tx`UPDATE trusted_devices SET revoked_at = ${new Date(now)} WHERE session_id = ${sessionId} AND revoked_at IS NULL`;
      return result.count > 0;
    });
  }

  async revokeAllUserSessions(userId: string, now: number): Promise<number> {
    return this.sql.begin(async (tx) => {
      const result = await tx`
        UPDATE sessions SET revoked_at = ${new Date(now)}
        WHERE user_id = ${userId} AND revoked_at IS NULL
      `;
      await tx`UPDATE trusted_devices SET revoked_at = ${new Date(now)} WHERE user_id = ${userId} AND revoked_at IS NULL`;
      return result.count;
    });
  }

  async listUserSessions(userId: string, now: number): Promise<readonly Session[]> {
    const rows = await this.sql`
      SELECT * FROM sessions
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
        AND expires_at > ${new Date(now)}
      ORDER BY created_at DESC
    `;
    return rows.map(parseSessionRow);
  }
}
