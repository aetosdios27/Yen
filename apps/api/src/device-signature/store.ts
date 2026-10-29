import crypto from "node:crypto";
import type { Sql } from "@yen/db";

export type DeviceChallengePurpose = "registration" | "assertion";

export interface DeviceCredential {
  readonly credentialId: string;
  readonly userId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly label: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

export interface DeviceChallenge {
  readonly challenge: string;
  readonly userId: string;
  readonly purpose: DeviceChallengePurpose;
  readonly actionHash: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

export interface DeviceSignatureProof {
  readonly proofId: string;
  readonly userId: string;
  readonly actionHash: string;
  readonly credentialIdHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

export type ClaimFailure = "unknown" | "expired" | "replayed" | "wrong_user" | "wrong_action";

export interface DeviceSignatureStore {
  listCredentials(userId: string): Promise<readonly DeviceCredential[]>;
  getCredential(userId: string, credentialId: string): Promise<DeviceCredential | null>;
  addCredential(credential: Omit<DeviceCredential, "lastUsedAt" | "revokedAt">): Promise<void>;
  updateCounter(
    userId: string,
    credentialId: string,
    expectedCounter: number,
    newCounter: number,
    now: number,
  ): Promise<boolean>;
  revokeCredential(userId: string, credentialId: string, now: number): Promise<boolean>;
  createChallenge(challenge: DeviceChallenge): Promise<void>;
  claimChallenge(input: {
    readonly challenge: string;
    readonly userId: string;
    readonly purpose: DeviceChallengePurpose;
    readonly actionHash: string | null;
    readonly now: number;
  }): Promise<
    { readonly claimed: true } | { readonly claimed: false; readonly reason: ClaimFailure }
  >;
  createProof(proof: DeviceSignatureProof): Promise<void>;
  consumeProof(input: {
    readonly proofId: string;
    readonly userId: string;
    readonly actionHash: string;
    readonly now: number;
  }): Promise<
    | { readonly consumed: true; readonly credentialIdHash: string }
    | { readonly consumed: false; readonly reason: ClaimFailure }
  >;
}

function claimFailure(
  row:
    | { userId: string; actionHash: string | null; expiresAt: number; consumedAt: number | null }
    | undefined,
  userId: string,
  actionHash: string | null,
  now: number,
): ClaimFailure {
  if (!row) return "unknown";
  if (row.consumedAt !== null) return "replayed";
  if (row.expiresAt <= now) return "expired";
  if (row.userId !== userId) return "wrong_user";
  if (row.actionHash !== actionHash) return "wrong_action";
  return "unknown";
}

export class MemoryDeviceSignatureStore implements DeviceSignatureStore {
  private readonly credentials = new Map<string, DeviceCredential>();
  private readonly challenges = new Map<string, DeviceChallenge>();
  private readonly proofs = new Map<string, DeviceSignatureProof>();

  async listCredentials(userId: string) {
    return [...this.credentials.values()]
      .filter((credential) => credential.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getCredential(userId: string, credentialId: string) {
    const credential = this.credentials.get(credentialId);
    return credential?.userId === userId ? { ...credential } : null;
  }

  async addCredential(credential: Omit<DeviceCredential, "lastUsedAt" | "revokedAt">) {
    if (this.credentials.has(credential.credentialId)) throw new Error("credential already exists");
    this.credentials.set(credential.credentialId, {
      ...credential,
      createdAt: credential.createdAt,
      lastUsedAt: null,
      revokedAt: null,
    });
  }

  async updateCounter(
    userId: string,
    credentialId: string,
    expectedCounter: number,
    newCounter: number,
    now: number,
  ) {
    const credential = this.credentials.get(credentialId);
    if (
      !credential ||
      credential.userId !== userId ||
      credential.revokedAt !== null ||
      credential.signCount !== expectedCounter ||
      (newCounter <= expectedCounter && !(newCounter === 0 && expectedCounter === 0))
    ) {
      return false;
    }
    this.credentials.set(credentialId, { ...credential, signCount: newCounter, lastUsedAt: now });
    return true;
  }

  async revokeCredential(userId: string, credentialId: string, now: number) {
    const credential = this.credentials.get(credentialId);
    if (!credential || credential.userId !== userId || credential.revokedAt !== null) return false;
    this.credentials.set(credentialId, { ...credential, revokedAt: now });
    return true;
  }

  async createChallenge(challenge: DeviceChallenge) {
    this.challenges.set(challenge.challenge, challenge);
  }

  async claimChallenge(input: {
    challenge: string;
    userId: string;
    purpose: DeviceChallengePurpose;
    actionHash: string | null;
    now: number;
  }) {
    const current = this.challenges.get(input.challenge);
    if (
      !current ||
      current.purpose !== input.purpose ||
      current.userId !== input.userId ||
      current.actionHash !== input.actionHash ||
      current.expiresAt <= input.now ||
      current.consumedAt !== null
    ) {
      return {
        claimed: false as const,
        reason:
          current?.purpose !== input.purpose
            ? "wrong_action"
            : claimFailure(current, input.userId, input.actionHash, input.now),
      };
    }
    this.challenges.set(input.challenge, { ...current, consumedAt: input.now });
    return { claimed: true as const };
  }

  async createProof(proof: DeviceSignatureProof) {
    this.proofs.set(proof.proofId, proof);
  }

  async consumeProof(input: { proofId: string; userId: string; actionHash: string; now: number }) {
    const current = this.proofs.get(input.proofId);
    if (
      !current ||
      current.userId !== input.userId ||
      current.actionHash !== input.actionHash ||
      current.expiresAt <= input.now ||
      current.consumedAt !== null
    ) {
      return {
        consumed: false as const,
        reason: claimFailure(current, input.userId, input.actionHash, input.now),
      };
    }
    this.proofs.set(input.proofId, { ...current, consumedAt: input.now });
    return { consumed: true as const, credentialIdHash: current.credentialIdHash };
  }
}

interface CredentialRow {
  credential_id: string;
  user_id: string;
  public_key: Uint8Array<ArrayBufferLike>;
  sign_count: string | number;
  transports: readonly string[] | string;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface ChallengeRow {
  challenge: string;
  user_id: string;
  purpose: DeviceChallengePurpose;
  action_hash: string | null;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

interface ProofRow {
  proof_id: string;
  user_id: string;
  action_hash: string;
  credential_id_hash: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function asCredential(row: CredentialRow): DeviceCredential {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: new Uint8Array(row.public_key),
    signCount: Number(row.sign_count),
    transports: typeof row.transports === "string" ? JSON.parse(row.transports) : row.transports,
    label: row.label,
    createdAt: row.created_at.getTime(),
    lastUsedAt: row.last_used_at?.getTime() ?? null,
    revokedAt: row.revoked_at?.getTime() ?? null,
  };
}

function asChallenge(row: ChallengeRow) {
  return {
    challenge: row.challenge,
    userId: row.user_id,
    purpose: row.purpose,
    actionHash: row.action_hash,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    consumedAt: row.consumed_at?.getTime() ?? null,
  } satisfies DeviceChallenge;
}

function asProof(row: ProofRow) {
  return {
    proofId: row.proof_id,
    userId: row.user_id,
    actionHash: row.action_hash,
    credentialIdHash: row.credential_id_hash,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    consumedAt: row.consumed_at?.getTime() ?? null,
  } satisfies DeviceSignatureProof;
}

export class PostgresDeviceSignatureStore implements DeviceSignatureStore {
  constructor(private readonly sql: Sql) {}

  async listCredentials(userId: string) {
    const rows = await this.sql<CredentialRow[]>`
      SELECT * FROM device_credentials WHERE user_id = ${userId} ORDER BY created_at
    `;
    return rows.map(asCredential);
  }

  async getCredential(userId: string, credentialId: string) {
    const rows = await this.sql<CredentialRow[]>`
      SELECT * FROM device_credentials WHERE user_id = ${userId} AND credential_id = ${credentialId}
    `;
    return rows[0] ? asCredential(rows[0]) : null;
  }

  async addCredential(credential: Omit<DeviceCredential, "lastUsedAt" | "revokedAt">) {
    await this.sql`
      INSERT INTO device_credentials (credential_id, user_id, public_key, sign_count, transports, label, created_at)
      VALUES (${credential.credentialId}, ${credential.userId}, ${Buffer.from(credential.publicKey)},
        ${credential.signCount}, ${JSON.stringify(credential.transports)}::jsonb, ${credential.label},
        ${new Date(credential.createdAt)})
    `;
  }

  async updateCounter(
    userId: string,
    credentialId: string,
    expectedCounter: number,
    newCounter: number,
    now: number,
  ) {
    const rows = await this.sql<{ credential_id: string }[]>`
      UPDATE device_credentials SET sign_count = ${newCounter}, last_used_at = ${new Date(now)}
      WHERE user_id = ${userId} AND credential_id = ${credentialId} AND revoked_at IS NULL
        AND sign_count = ${expectedCounter}
        AND (${newCounter} > sign_count OR (${newCounter} = 0 AND sign_count = 0))
      RETURNING credential_id
    `;
    return rows.length === 1;
  }

  async revokeCredential(userId: string, credentialId: string, now: number) {
    const rows = await this.sql<{ credential_id: string }[]>`
      UPDATE device_credentials SET revoked_at = ${new Date(now)}
      WHERE user_id = ${userId} AND credential_id = ${credentialId} AND revoked_at IS NULL
      RETURNING credential_id
    `;
    return rows.length === 1;
  }

  async createChallenge(challenge: DeviceChallenge) {
    await this.sql`
      INSERT INTO device_webauthn_challenges (challenge, user_id, purpose, action_hash, created_at, expires_at)
      VALUES (${challenge.challenge}, ${challenge.userId}, ${challenge.purpose}, ${challenge.actionHash},
        ${new Date(challenge.createdAt)}, ${new Date(challenge.expiresAt)})
    `;
  }

  async claimChallenge(input: {
    challenge: string;
    userId: string;
    purpose: DeviceChallengePurpose;
    actionHash: string | null;
    now: number;
  }) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ChallengeRow[]>`
        SELECT * FROM device_webauthn_challenges WHERE challenge = ${input.challenge} FOR UPDATE
      `;
      const current = rows[0] ? asChallenge(rows[0]) : undefined;
      const reason = claimFailure(current, input.userId, input.actionHash, input.now);
      if (
        !current ||
        current.userId !== input.userId ||
        current.purpose !== input.purpose ||
        current.actionHash !== input.actionHash ||
        current.expiresAt <= input.now ||
        current.consumedAt !== null
      ) {
        return {
          claimed: false as const,
          reason: current?.purpose !== input.purpose ? ("wrong_action" as const) : reason,
        };
      }
      await tx`UPDATE device_webauthn_challenges SET consumed_at = ${new Date(input.now)} WHERE challenge = ${input.challenge}`;
      return { claimed: true as const };
    });
  }

  async createProof(proof: DeviceSignatureProof) {
    await this.sql`
      INSERT INTO device_signature_proofs (proof_id, user_id, action_hash, credential_id_hash, created_at, expires_at)
      VALUES (${proof.proofId}, ${proof.userId}, ${proof.actionHash}, ${proof.credentialIdHash},
        ${new Date(proof.createdAt)}, ${new Date(proof.expiresAt)})
    `;
  }

  async consumeProof(input: { proofId: string; userId: string; actionHash: string; now: number }) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ProofRow[]>`
        SELECT * FROM device_signature_proofs WHERE proof_id = ${input.proofId} FOR UPDATE
      `;
      const current = rows[0] ? asProof(rows[0]) : undefined;
      const reason = claimFailure(current, input.userId, input.actionHash, input.now);
      if (
        !current ||
        current.userId !== input.userId ||
        current.actionHash !== input.actionHash ||
        current.expiresAt <= input.now ||
        current.consumedAt !== null
      ) {
        return { consumed: false as const, reason };
      }
      await tx`UPDATE device_signature_proofs SET consumed_at = ${new Date(input.now)} WHERE proof_id = ${input.proofId}`;
      return { consumed: true as const, credentialIdHash: current.credentialIdHash };
    });
  }
}

export function hashCredentialId(credentialId: string): string {
  return crypto.createHash("sha256").update(credentialId, "utf8").digest("hex");
}
