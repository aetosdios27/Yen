import {
  type AuditBundle,
  type AuditCheck,
  computeCanonicalEventHash,
  createEventProof,
  type EventProof,
  fromHex,
  type Hash32,
  hash32,
  type Paise,
  paise,
  parseFundId,
  rootRegistryAbi,
  salt32,
  verifyAuditBundle,
  verifyEventProof,
} from "@yen/shared";
import { type Address, createPublicClient, http } from "viem";
import { polygonAmoy } from "viem/chains";

export type VerificationOutcome = "verified" | "skipped" | "pending" | "failed";

export interface RecordProofData {
  recordId: string;
  fundId: string;
  status: "anchored" | "pending";
  event: {
    fund_id: string;
    seq: number;
    type: string;
    version: number;
    actor: string;
    occurred_at: string;
    payload: Record<string, unknown>;
    prev_hash: string;
    hash: string;
  };
  salt?: string;
  latestEventHash?: string;
  eventProof?: {
    index: number;
    size: number;
    path: string[];
  };
  fundProof?: {
    index: number;
    size: number;
    path: string[];
  };
  anchor?: {
    chainId: number;
    contractAddress: string;
    txHash: string;
    root: string;
    sequence: number;
  };
  pendingWindow?: {
    message: string;
    estimatedAnchorMinutes: number;
  };
}

export interface VerifyRecordOptions {
  rpcUrl?: string;
  skipOnChainCheck?: boolean;
}

export interface RecordVerificationReport {
  outcome: VerificationOutcome;
  recordId: string;
  fundId: string;
  occurredAt?: string | undefined;
  amountPaise?: Paise | undefined;
  headline: string;
  detailMessage: string;
  checks: {
    eventHashValid: boolean;
    merkleProofValid: boolean;
    onChainAnchorValid: boolean | "pending" | "skipped";
  };
  technical: {
    canonicalEventHash: string;
    declaredHash: string;
    salt?: string | undefined;
    latestEventHash?: string | undefined;
    contractAddress?: string | undefined;
    txHash?: string | undefined;
    chainId?: number | undefined;
    batchSequence?: number | undefined;
    expectedRoot?: string | undefined;
    onChainRoot?: string | undefined;
    proofPath?: string[] | undefined;
    failureReason?: string | undefined;
  };
  rawEvent: Record<string, unknown>;
}

export interface BundleVerificationReport {
  format: string;
  fundId: string;
  totalEvents: number;
  validEvents: number;
  allValid: boolean;
  checks: AuditCheck[];
  anchor: {
    chainId: number;
    contractAddress: string;
    sequence: number;
    root: string;
    txHash: string;
  };
}

/**
 * Reads root from RootRegistry smart contract via viem public client.
 */
export async function verifyOnChainRoot(
  contractAddress: string,
  sequence: number,
  expectedRootHex: string,
  rpcUrl?: string,
): Promise<{ valid: boolean; onChainRoot?: string; error?: string }> {
  try {
    const client = createPublicClient({
      chain: polygonAmoy,
      transport: http(rpcUrl || "https://rpc-amoy.polygon.technology", {
        timeout: 3500,
        retryCount: 0,
      }),
    });

    const rootBytes32 = (await client.readContract({
      address: contractAddress as Address,
      abi: rootRegistryAbi,
      functionName: "rootAt",
      args: [BigInt(sequence)],
    })) as `0x${string}`;

    const normalizedOnChain = rootBytes32.replace(/^0x/, "").toLowerCase();
    const normalizedExpected = expectedRootHex.replace(/^0x/, "").toLowerCase();
    return {
      valid: normalizedOnChain === normalizedExpected,
      onChainRoot: normalizedOnChain,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Cryptographically verifies a single record proof.
 */
export async function verifyRecordProofData(
  proofData: RecordProofData,
  options?: VerifyRecordOptions,
): Promise<RecordVerificationReport> {
  const { recordId, fundId, status, event, salt, latestEventHash, eventProof, fundProof, anchor } =
    proofData;

  const rawEvent = event as Record<string, unknown>;
  const canonicalHash = await computeCanonicalEventHash(event);
  const hashMatches = canonicalHash.toLowerCase() === event.hash.toLowerCase();

  let amountPaise: Paise | undefined;
  if (event.payload && typeof event.payload === "object" && "amount_paise" in event.payload) {
    const amt = event.payload.amount_paise;
    if (typeof amt === "number" || typeof amt === "bigint" || typeof amt === "string") {
      amountPaise = paise(Number(amt));
    }
  }

  // Handle pending records
  if (status === "pending") {
    return {
      outcome: "pending",
      recordId,
      fundId,
      occurredAt: event.occurred_at,
      amountPaise,
      headline: "Sealed in event log; awaiting next scheduled public seal",
      detailMessage:
        proofData.pendingWindow?.message ??
        "This record is safely recorded in the account book and awaiting the next scheduled seal batch.",
      checks: {
        eventHashValid: hashMatches,
        merkleProofValid: true,
        onChainAnchorValid: "pending",
      },
      technical: {
        canonicalEventHash: canonicalHash,
        declaredHash: event.hash,
        failureReason: undefined,
      },
      rawEvent,
    };
  }

  // Handle hash mismatch immediately
  if (!hashMatches) {
    return {
      outcome: "failed",
      recordId,
      fundId,
      occurredAt: event.occurred_at,
      amountPaise,
      headline: "Verification failed: record was altered",
      detailMessage: "The record payload does not match its cryptographic hash signature.",
      checks: {
        eventHashValid: false,
        merkleProofValid: false,
        onChainAnchorValid: false,
      },
      technical: {
        canonicalEventHash: canonicalHash,
        declaredHash: event.hash,
        salt,
        failureReason: "Event hash does not match canonical payload hash",
      },
      rawEvent,
    };
  }

  // Verify Merkle inclusion proof
  let merkleValid = false;
  let merkleError: string | undefined;

  if (salt && latestEventHash && eventProof && fundProof && anchor) {
    try {
      const parsedFund = parseFundId(fundId);
      if (!parsedFund.ok) {
        throw new Error(`Invalid fund ID: ${parsedFund.error}`);
      }

      const parsedProof: EventProof = createEventProof({
        format: "yen/event-proof/v1",
        salt: salt32(fromHex(salt)),
        eventHash: hash32(fromHex(event.hash)),
        eventProof: {
          index: eventProof.index,
          size: eventProof.size,
          path: eventProof.path.map((h) => hash32(fromHex(h))),
        },
        fundId: parsedFund.value,
        latestEventHash: hash32(fromHex(latestEventHash)),
        fundProof: {
          index: fundProof.index,
          size: fundProof.size,
          path: fundProof.path.map((h) => hash32(fromHex(h))),
        },
      });

      const expectedRoot: Hash32 = hash32(fromHex(anchor.root));
      merkleValid = await verifyEventProof(parsedProof, expectedRoot);
      if (!merkleValid) {
        merkleError = "Merkle proof path does not reconstruct the public seal root";
      }
    } catch (err) {
      merkleValid = false;
      merkleError = err instanceof Error ? err.message : String(err);
    }
  } else {
    merkleError = "Proof data is incomplete (missing salt, proofs, or anchor)";
  }

  if (!merkleValid) {
    return {
      outcome: "failed",
      recordId,
      fundId,
      occurredAt: event.occurred_at,
      amountPaise,
      headline: "Verification failed: seal mismatch",
      detailMessage:
        "The record could not be proven against the public seal root. The record or proof path may have been modified.",
      checks: {
        eventHashValid: true,
        merkleProofValid: false,
        onChainAnchorValid: false,
      },
      technical: {
        canonicalEventHash: canonicalHash,
        declaredHash: event.hash,
        salt,
        latestEventHash,
        expectedRoot: anchor?.root,
        proofPath: eventProof?.path,
        failureReason: merkleError,
      },
      rawEvent,
    };
  }

  // On-chain anchor verification
  let onChainValid: boolean | "skipped" = "skipped";
  let onChainRoot: string | undefined;

  if (!options?.skipOnChainCheck && anchor?.contractAddress && anchor.sequence) {
    const onChainResult = await verifyOnChainRoot(
      anchor.contractAddress,
      anchor.sequence,
      anchor.root,
      options?.rpcUrl,
    );

    if (onChainResult.onChainRoot !== undefined) {
      onChainRoot = onChainResult.onChainRoot;
      onChainValid = onChainResult.valid;
    } else {
      onChainValid = "skipped";
    }
  }

  // If on-chain was checked and explicitly mismatched: fail
  if (onChainValid === false) {
    return {
      outcome: "failed",
      recordId,
      fundId,
      occurredAt: event.occurred_at,
      amountPaise,
      headline: "Verification failed: public registry mismatch",
      detailMessage: "The sealed root does not match the published public registry entry.",
      checks: {
        eventHashValid: true,
        merkleProofValid: true,
        onChainAnchorValid: false,
      },
      technical: {
        canonicalEventHash: canonicalHash,
        declaredHash: event.hash,
        salt,
        latestEventHash,
        expectedRoot: anchor?.root,
        onChainRoot,
        contractAddress: anchor?.contractAddress,
        batchSequence: anchor?.sequence,
        failureReason: "On-chain published root differs from anchor root",
      },
      rawEvent,
    };
  }

  // All checks passed
  const dateFormatted = event.occurred_at
    ? new Date(event.occurred_at).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "the recorded date";

  const isFullyVerified = onChainValid === true;
  const outcome: VerificationOutcome = isFullyVerified ? "verified" : "skipped";

  return {
    outcome,
    recordId,
    fundId,
    occurredAt: event.occurred_at,
    amountPaise,
    headline: isFullyVerified
      ? `This record was written on ${dateFormatted} and has not been changed since`
      : `Record integrity verified against event seal; public registry check was skipped`,
    detailMessage: isFullyVerified
      ? "Cryptographic proof matches the publicly sealed registry entry."
      : "Cryptographic proof is intact against the audit bundle seal, but on-chain registry verification was skipped or offline.",
    checks: {
      eventHashValid: true,
      merkleProofValid: true,
      onChainAnchorValid: onChainValid,
    },
    technical: {
      canonicalEventHash: canonicalHash,
      declaredHash: event.hash,
      salt,
      latestEventHash,
      expectedRoot: anchor?.root,
      onChainRoot,
      contractAddress: anchor?.contractAddress,
      txHash: anchor?.txHash,
      chainId: anchor?.chainId,
      batchSequence: anchor?.sequence,
      proofPath: eventProof?.path,
    },
    rawEvent,
  };
}

/**
 * Verifies an entire audit bundle and produces a structured report.
 */
export async function verifyUploadedBundle(bundle: AuditBundle): Promise<BundleVerificationReport> {
  const checks = await verifyAuditBundle(bundle);
  const allValid = checks.every((c) => c.ok);

  return {
    format: bundle.format,
    fundId: bundle.fund_id,
    totalEvents: bundle.events.length,
    validEvents: allValid ? bundle.events.length : 0,
    allValid,
    checks,
    anchor: {
      chainId: bundle.anchor.chain_id,
      contractAddress: bundle.anchor.contract_address,
      sequence: bundle.anchor.sequence,
      root: bundle.anchor.root,
      txHash: bundle.anchor.tx_hash,
    },
  };
}
