import { authOtpRowSchema, type Sql, sessionRowSchema, userRowSchema, uuidv7 } from "@yen/db";
import type { PhoneE164 } from "@yen/shared";

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
  createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge>;
  getLatestActiveOtpChallenge(phone: PhoneE164, now: number): Promise<OtpChallenge | null>;
  incrementOtpAttempts(challengeId: string): Promise<OtpChallenge | null>;
  consumeOtpChallenge(challengeId: string, now: number): Promise<void>;

  findOrCreateUserByPhone(phone: PhoneE164, now: number): Promise<User>;
  getUserById(userId: string): Promise<User | null>;

  createSession(input: CreateSessionInput): Promise<Session>;
  findSessionByTokenHash(tokenHash: string, now: number): Promise<Session | null>;
  touchSession(sessionId: string, now: number): Promise<void>;
  rotateSession(
    sessionId: string,
    newTokenHash: string,
    newExpiresAt: number,
    now: number,
  ): Promise<Session | null>;
  revokeSession(sessionId: string, now: number): Promise<boolean>;
  revokeAllUserSessions(userId: string, now: number): Promise<number>;
  listUserSessions(userId: string, now: number): Promise<readonly Session[]>;
}

export class MemoryAuthStore implements AuthStore {
  private readonly challenges = new Map<string, OtpChallenge>();
  private readonly users = new Map<string, User>(); // key: userId
  private readonly usersByPhone = new Map<string, string>(); // phone -> userId
  private readonly sessions = new Map<string, Session>(); // key: sessionId
  private readonly sessionTokenToId = new Map<string, string>(); // tokenHash -> sessionId

  constructor(private readonly idGenerator: () => string = () => crypto.randomUUID()) {}

  async createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge> {
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

  async incrementOtpAttempts(challengeId: string): Promise<OtpChallenge | null> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return null;
    const updated: OtpChallenge = {
      ...challenge,
      attempts: challenge.attempts + 1,
    };
    this.challenges.set(challengeId, updated);
    return updated;
  }

  async consumeOtpChallenge(challengeId: string, now: number): Promise<void> {
    const challenge = this.challenges.get(challengeId);
    if (challenge) {
      this.challenges.set(challengeId, {
        ...challenge,
        consumedAt: now,
      });
    }
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
    };
    this.users.set(newUser.id, newUser);
    this.usersByPhone.set(phone, newUser.id);
    return newUser;
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
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
    newExpiresAt: number,
    now: number,
  ): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt !== null || now >= session.expiresAt) return null;
    this.sessionTokenToId.delete(session.tokenHash);
    const updated: Session = {
      ...session,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
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
  };
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly sql: Sql) {}

  async createOtpChallenge(input: CreateChallengeInput): Promise<OtpChallenge> {
    const rows = await this.sql`
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

  async incrementOtpAttempts(challengeId: string): Promise<OtpChallenge | null> {
    const rows = await this.sql`
      UPDATE auth_otps
      SET attempts = attempts + 1
      WHERE id = ${challengeId}
      RETURNING *
    `;
    return rows.length > 0 ? parseAuthOtpRow(rows[0]) : null;
  }

  async consumeOtpChallenge(challengeId: string, now: number): Promise<void> {
    await this.sql`
      UPDATE auth_otps
      SET consumed_at = ${new Date(now)}
      WHERE id = ${challengeId}
    `;
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
    // Create initial pseudonym row for anonymity
    await this.sql`
      INSERT INTO pseudonyms (pseudonym_id, user_id)
      VALUES (${uuidv7()}, ${user.id})
      ON CONFLICT DO NOTHING
    `;
    return user;
  }

  async getUserById(userId: string): Promise<User | null> {
    const rows = await this.sql`SELECT * FROM users WHERE id = ${userId}`;
    return rows.length > 0 ? parseUserRow(rows[0]) : null;
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
    newExpiresAt: number,
    now: number,
  ): Promise<Session | null> {
    const rows = await this.sql`
      UPDATE sessions
      SET token_hash = ${newTokenHash},
          expires_at = ${new Date(newExpiresAt)},
          last_active_at = ${new Date(now)}
      WHERE id = ${sessionId} AND revoked_at IS NULL
      RETURNING *
    `;
    return rows.length > 0 ? parseSessionRow(rows[0]) : null;
  }

  async revokeSession(sessionId: string, now: number): Promise<boolean> {
    const result = await this.sql`
      UPDATE sessions
      SET revoked_at = ${new Date(now)}
      WHERE id = ${sessionId} AND revoked_at IS NULL
    `;
    return result.count > 0;
  }

  async revokeAllUserSessions(userId: string, now: number): Promise<number> {
    const result = await this.sql`
      UPDATE sessions
      SET revoked_at = ${new Date(now)}
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    return result.count;
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
