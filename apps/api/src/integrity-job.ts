import crypto from "node:crypto";
import type { StorageAdapter } from "./storage.js";
import type { StoredEvidence } from "./stores.js";

export type IntegrityCheckResult =
  | {
      readonly status: "valid";
      readonly evidenceId: string;
      readonly sha256: string;
      readonly checkedAt: string;
    }
  | {
      readonly status: "tampered";
      readonly evidenceId: string;
      readonly pinnedSha256: string;
      readonly actualSha256: string;
      readonly detectedAt: string;
    }
  | {
      readonly status: "missing";
      readonly evidenceId: string;
      readonly objectKey: string;
      readonly error: string;
    };

export interface IntegrityJobSummary {
  readonly totalChecked: number;
  readonly validCount: number;
  readonly tamperedCount: number;
  readonly missingCount: number;
  readonly tamperedItems: Array<{
    evidenceId: string;
    pinnedSha256: string;
    actualSha256: string;
  }>;
}

export class EvidenceIntegrityError extends Error {
  constructor() {
    super("Stored evidence failed its SHA-256 integrity check");
    this.name = "EvidenceIntegrityError";
  }
}

export async function getVerifiedEvidenceObject(evidence: StoredEvidence, storage: StorageAdapter) {
  const storageObj = await storage.getObject(evidence.objectKey ?? evidence.evidenceId);
  const actualSha256 = crypto.createHash("sha256").update(storageObj.data).digest("hex");
  if (actualSha256 !== evidence.fileSha256) throw new EvidenceIntegrityError();
  return storageObj;
}

/**
 * Checks the cryptographic integrity of a stored evidence file by fetching its raw bytes
 * directly from durable storage, computing SHA-256 server-side, and verifying it against
 * the pinned hash in the immutable evidence record / event log.
 */
export async function checkEvidenceIntegrity(
  evidence: StoredEvidence,
  storage: StorageAdapter,
): Promise<IntegrityCheckResult> {
  const objectKey = evidence.objectKey ?? evidence.evidenceId;
  const now = new Date().toISOString();

  let storageObj: { data: Uint8Array };
  try {
    storageObj = await storage.getObject(objectKey);
  } catch (error) {
    return {
      status: "missing",
      evidenceId: evidence.evidenceId,
      objectKey,
      error: error instanceof Error ? error.message : "File not found in storage",
    };
  }

  const actualSha256 = crypto.createHash("sha256").update(storageObj.data).digest("hex");

  if (actualSha256 !== evidence.fileSha256) {
    return {
      status: "tampered",
      evidenceId: evidence.evidenceId,
      pinnedSha256: evidence.fileSha256,
      actualSha256,
      detectedAt: now,
    };
  }

  return {
    status: "valid",
    evidenceId: evidence.evidenceId,
    sha256: actualSha256,
    checkedAt: now,
  };
}

/**
 * Runs a batch integrity verification job across a set of evidence records.
 */
export async function runEvidenceIntegrityJob(
  evidenceList: readonly StoredEvidence[],
  storage: StorageAdapter,
): Promise<IntegrityJobSummary> {
  let validCount = 0;
  let tamperedCount = 0;
  let missingCount = 0;
  const tamperedItems: Array<{
    evidenceId: string;
    pinnedSha256: string;
    actualSha256: string;
  }> = [];

  for (const item of evidenceList) {
    const result = await checkEvidenceIntegrity(item, storage);
    if (result.status === "valid") {
      validCount++;
    } else if (result.status === "tampered") {
      tamperedCount++;
      tamperedItems.push({
        evidenceId: result.evidenceId,
        pinnedSha256: result.pinnedSha256,
        actualSha256: result.actualSha256,
      });
    } else if (result.status === "missing") {
      missingCount++;
    }
  }

  return {
    totalChecked: evidenceList.length,
    validCount,
    tamperedCount,
    missingCount,
    tamperedItems,
  };
}
