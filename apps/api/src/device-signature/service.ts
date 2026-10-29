import crypto from "node:crypto";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  type ClaimFailure,
  type DeviceCredential,
  type DeviceSignatureStore,
  hashCredentialId,
} from "./store.js";

const CHALLENGE_TTL_MS = 60_000;
const PROOF_TTL_MS = 60_000;

export type DeviceSignatureFailureReason =
  | ClaimFailure
  | "malformed_response"
  | "wrong_origin"
  | "wrong_rp_id"
  | "invalid_signature"
  | "counter_regression"
  | "revoked_credential"
  | "unknown_credential"
  | "missing_credentials";

export class DeviceSignatureFailure extends Error {
  constructor(readonly reason: DeviceSignatureFailureReason) {
    super(`Device signature verification failed (${reason})`);
    this.name = "DeviceSignatureFailure";
  }
}

export interface DeviceSignatureConfig {
  readonly rpId: string;
  readonly origin: string;
  readonly rpName: string;
}

export interface DeviceCredentialSummary {
  readonly credentialId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

function webAuthnChallenge(response: { readonly response: { readonly clientDataJSON: string } }) {
  try {
    const data = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
    ) as { readonly challenge?: unknown };
    if (typeof data.challenge !== "string" || data.challenge.length > 256) {
      throw new Error("invalid challenge");
    }
    return data.challenge;
  } catch {
    throw new DeviceSignatureFailure("malformed_response");
  }
}

function failureFromVerification(error: unknown): DeviceSignatureFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("origin")) return "wrong_origin";
  if (message.includes("rp id") || message.includes("rpid")) return "wrong_rp_id";
  if (message.includes("counter")) return "counter_regression";
  return "invalid_signature";
}

export class DeviceSignatureService {
  private readonly store: DeviceSignatureStore;
  private readonly config: DeviceSignatureConfig;
  private readonly clock: () => number;

  constructor(options: {
    readonly store: DeviceSignatureStore;
    readonly config: DeviceSignatureConfig;
    readonly clock?: () => number;
  }) {
    this.store = options.store;
    this.config = options.config;
    this.clock = options.clock ?? Date.now;
  }

  async registrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const credentials = await this.store.listCredentials(userId);
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: userId,
      userDisplayName: "Yen member",
      userID: Buffer.from(userId, "utf8"),
      timeout: CHALLENGE_TTL_MS,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: credentials
        .filter((credential) => credential.revokedAt === null)
        .map((credential) => ({
          id: credential.credentialId,
          transports: [...credential.transports],
        })),
    });
    const now = this.clock();
    await this.store.createChallenge({
      challenge: options.challenge,
      userId,
      purpose: "registration",
      actionHash: null,
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
      consumedAt: null,
    });
    return options;
  }

  async register(
    userId: string,
    label: string,
    response: RegistrationResponseJSON,
  ): Promise<DeviceCredentialSummary> {
    const challenge = webAuthnChallenge(response);
    const now = this.clock();
    const claim = await this.store.claimChallenge({
      challenge,
      userId,
      purpose: "registration",
      actionHash: null,
      now,
    });
    if (!claim.claimed) throw new DeviceSignatureFailure(claim.reason);

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch (error) {
      throw new DeviceSignatureFailure(failureFromVerification(error));
    }
    if (!verification.verified) throw new DeviceSignatureFailure("invalid_signature");

    const { credential } = verification.registrationInfo;
    const counter = credential.counter;
    await this.store.addCredential({
      credentialId: credential.id,
      userId,
      publicKey: credential.publicKey,
      signCount: counter,
      transports: credential.transports ?? response.response.transports ?? [],
      label,
      createdAt: now,
    });
    const saved = await this.store.getCredential(userId, credential.id);
    if (!saved) throw new Error("Registered device credential was not saved");
    return this.summary(saved);
  }

  async assertionOptions(
    userId: string,
    actionHash: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    if (!/^[0-9a-f]{64}$/.test(actionHash)) throw new DeviceSignatureFailure("wrong_action");
    const credentials = (await this.store.listCredentials(userId)).filter(
      (credential) => credential.revokedAt === null,
    );
    if (credentials.length === 0) throw new DeviceSignatureFailure("missing_credentials");

    const challenge = crypto
      .createHash("sha256")
      .update(crypto.randomBytes(32))
      .update(Buffer.from(actionHash, "hex"))
      .digest("base64url");
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      challenge,
      timeout: CHALLENGE_TTL_MS,
      userVerification: "required",
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: [...credential.transports],
      })),
    });
    const now = this.clock();
    await this.store.createChallenge({
      challenge: options.challenge,
      userId,
      purpose: "assertion",
      actionHash,
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
      consumedAt: null,
    });
    return options;
  }

  async verifyAssertion(
    userId: string,
    actionHash: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ readonly deviceProof: string; readonly expiresAt: string }> {
    const challenge = webAuthnChallenge(response);
    const now = this.clock();
    const claim = await this.store.claimChallenge({
      challenge,
      userId,
      purpose: "assertion",
      actionHash,
      now,
    });
    if (!claim.claimed) throw new DeviceSignatureFailure(claim.reason);

    const credential = await this.store.getCredential(userId, response.id);
    if (!credential) throw new DeviceSignatureFailure("unknown_credential");
    if (credential.revokedAt !== null) throw new DeviceSignatureFailure("revoked_credential");

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: credential.publicKey,
          counter: credential.signCount,
          transports: [...credential.transports],
        },
        requireUserVerification: true,
      });
    } catch (error) {
      throw new DeviceSignatureFailure(failureFromVerification(error));
    }
    if (!verification.verified) throw new DeviceSignatureFailure("invalid_signature");

    const nextCounter = verification.authenticationInfo.newCounter;
    if (
      nextCounter < credential.signCount ||
      (credential.signCount > 0 && nextCounter <= credential.signCount)
    ) {
      throw new DeviceSignatureFailure("counter_regression");
    }
    const counterUpdated = await this.store.updateCounter(
      userId,
      credential.credentialId,
      credential.signCount,
      nextCounter,
      now,
    );
    if (!counterUpdated) {
      const current = await this.store.getCredential(userId, credential.credentialId);
      throw new DeviceSignatureFailure(
        !current
          ? "unknown_credential"
          : current.revokedAt !== null
            ? "revoked_credential"
            : "counter_regression",
      );
    }

    const proofId = crypto.randomUUID();
    const expiresAt = now + PROOF_TTL_MS;
    await this.store.createProof({
      proofId,
      userId,
      actionHash,
      credentialIdHash: hashCredentialId(credential.credentialId),
      createdAt: now,
      expiresAt,
      consumedAt: null,
    });
    return { deviceProof: proofId, expiresAt: new Date(expiresAt).toISOString() };
  }

  async consumeProof(userId: string, actionHash: string, proofId: string) {
    const result = await this.store.consumeProof({
      proofId,
      userId,
      actionHash,
      now: this.clock(),
    });
    if (!result.consumed) throw new DeviceSignatureFailure(result.reason);
    return result.credentialIdHash;
  }

  async listCredentials(userId: string): Promise<readonly DeviceCredentialSummary[]> {
    return (await this.store.listCredentials(userId)).map((credential) => this.summary(credential));
  }

  async revokeCredential(userId: string, credentialId: string): Promise<boolean> {
    return this.store.revokeCredential(userId, credentialId, this.clock());
  }

  private summary(credential: DeviceCredential): DeviceCredentialSummary {
    return {
      credentialId: credential.credentialId,
      label: credential.label,
      createdAt: new Date(credential.createdAt).toISOString(),
      lastUsedAt:
        credential.lastUsedAt === null ? null : new Date(credential.lastUsedAt).toISOString(),
      revokedAt:
        credential.revokedAt === null ? null : new Date(credential.revokedAt).toISOString(),
    };
  }
}
