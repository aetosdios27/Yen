import {
  type AuditBundle,
  buildIntervalTree,
  computeCanonicalEventHash,
  fromHex,
  hash32,
  parseFundId,
  salt32,
  toHex,
} from "@yen/shared";
import { describe, expect, it } from "vitest";
import { type RecordProofData, verifyRecordProofData, verifyUploadedBundle } from "./verifier.js";

async function createValidProofFixture(): Promise<RecordProofData & { eventRoot: string }> {
  const fundResult = parseFundId("00000000-0000-4000-8000-000000000010");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;
  const recordId = "00000000-0000-4000-8000-000000000020";

  const event = {
    fund_id: fundId,
    seq: 1,
    type: "expense.submitted",
    version: 1,
    actor: "psn_00000000-0000-4000-8000-000000000002",
    occurred_at: "2026-10-28T00:00:00.000Z",
    payload: { expense_id: recordId, amount_paise: 8500000 },
    prev_hash: "0".repeat(64),
    hash: "",
  };

  event.hash = await computeCanonicalEventHash(event);
  const salt = "11".repeat(32);

  const tree = await buildIntervalTree([
    {
      fundId,
      latestEventHash: hash32(fromHex(event.hash)),
      events: [{ seq: 1, eventHash: hash32(fromHex(event.hash)), salt: salt32(fromHex(salt)) }],
    },
  ]);

  const proof = await tree.prove(fundId, 1);
  const root = toHex(tree.root);

  return {
    recordId,
    fundId,
    status: "anchored",
    event,
    salt,
    latestEventHash: toHex(proof.latestEventHash),
    eventProof: {
      index: proof.eventProof.index,
      size: proof.eventProof.size,
      path: proof.eventProof.path.map(toHex),
    },
    fundProof: {
      index: proof.fundProof.index,
      size: proof.fundProof.size,
      path: proof.fundProof.path.map(toHex),
    },
    anchor: {
      chainId: 80002,
      contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      root,
      sequence: 1,
    },
    eventRoot: toHex(tree.fundRoots[0] ?? hash32(new Uint8Array(32))),
  };
}

describe("Verifier Engine (verifier.ts)", () => {
  it("verifies a valid anchored record proof with skipped on-chain check", async () => {
    const fixture = await createValidProofFixture();
    const result = await verifyRecordProofData(fixture, { skipOnChainCheck: true });

    expect(result.outcome).toBe("skipped");
    expect(result.checks.eventHashValid).toBe(true);
    expect(result.checks.merkleProofValid).toBe(true);
    expect(result.checks.onChainAnchorValid).toBe("skipped");
    expect(result.amountPaise).toBe(8500000);
    expect(result.headline).toContain("Record integrity verified against event seal");
  });

  it("detects tampered event payload and returns failed status", async () => {
    const fixture = await createValidProofFixture();
    // Tamper with amount
    fixture.event.payload.amount_paise = 9999999;

    const result = await verifyRecordProofData(fixture, { skipOnChainCheck: true });

    expect(result.outcome).toBe("failed");
    expect(result.checks.eventHashValid).toBe(false);
    expect(result.checks.merkleProofValid).toBe(false);
    expect(result.headline).toContain("Verification failed: record was altered");
  });

  it("detects tampered Merkle proof path and returns failed status", async () => {
    const fixture = await createValidProofFixture();
    if (fixture.eventProof) {
      fixture.eventProof.path = ["ff".repeat(32)];
    }

    const result = await verifyRecordProofData(fixture, { skipOnChainCheck: true });

    expect(result.outcome).toBe("failed");
    expect(result.checks.eventHashValid).toBe(true);
    expect(result.checks.merkleProofValid).toBe(false);
    expect(result.headline).toContain("Verification failed: seal mismatch");
  });

  it("detects pending record and returns pending status without failure", async () => {
    const fixture = await createValidProofFixture();
    fixture.status = "pending";
    fixture.pendingWindow = {
      message: "Sealed in event log; awaiting next scheduled batch anchor",
      estimatedAnchorMinutes: 10,
    };

    const result = await verifyRecordProofData(fixture);

    expect(result.outcome).toBe("pending");
    expect(result.checks.onChainAnchorValid).toBe("pending");
    expect(result.headline).toContain("Sealed in event log");
  });

  it("handles offline mode gracefully when RPC is unreachable and returns skipped outcome", async () => {
    const fixture = await createValidProofFixture();
    // Use an unroutable RPC URL to simulate offline/network failure
    const result = await verifyRecordProofData(fixture, {
      rpcUrl: "http://127.0.0.1:19999",
      skipOnChainCheck: false,
    });

    expect(result.outcome).toBe("skipped");
    expect(result.checks.eventHashValid).toBe(true);
    expect(result.checks.merkleProofValid).toBe(true);
    expect(result.checks.onChainAnchorValid).toBe("skipped");
  });

  it("verifies uploaded audit bundle correctly", async () => {
    const fixture = await createValidProofFixture();
    const bundle: AuditBundle = {
      format: "yen/audit-bundle/v1",
      fund_id: fixture.fundId,
      chain: { start_seq: 0, start_hash: "0".repeat(64) },
      events: [
        {
          event: fixture.event,
          salt: fixture.salt ?? "",
          latest_event_hash: fixture.latestEventHash ?? "",
          eventProof: fixture.eventProof ?? { index: 0, size: 1, path: [] },
          fundProof: fixture.fundProof ?? { index: 0, size: 1, path: [] },
        },
      ],
      roots: [
        {
          start_seq: 1,
          end_seq: 1,
          event_root: fixture.eventRoot,
          fund_count: 1,
          global_root: fixture.anchor?.root ?? "",
        },
      ],
      anchor: {
        chain_id: fixture.anchor?.chainId ?? 80002,
        contract_address: fixture.anchor?.contractAddress ?? "",
        tx_hash: fixture.anchor?.txHash ?? "",
        root: fixture.anchor?.root ?? "",
        sequence: fixture.anchor?.sequence ?? 1,
      },
    };

    const report = await verifyUploadedBundle(bundle);
    expect(report.allValid).toBe(true);
    expect(report.totalEvents).toBe(1);
    expect(report.validEvents).toBe(1);
  });
});
