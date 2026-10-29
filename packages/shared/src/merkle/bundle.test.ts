import { describe, expect, it } from "vitest";
import malformedRangeFixture from "../../../verifier/vectors/v1/malformed-batch-range.json" with {
  type: "json",
};
import tamperedAnchorFixture from "../../../verifier/vectors/v1/tampered-anchor-root.json" with {
  type: "json",
};
import tamperedPayloadFixture from "../../../verifier/vectors/v1/tampered-event-payload.json" with {
  type: "json",
};
import tamperedProofFixture from "../../../verifier/vectors/v1/tampered-inclusion-path.json" with {
  type: "json",
};
import validFixture from "../../../verifier/vectors/v1/valid-two-events.json" with {
  type: "json",
};
import {
  type AuditBundle,
  AuditReasonCode,
  canonicalizeJson,
  computeCanonicalEventHash,
  exportAuditBundleCsv,
  verifyAuditBundle,
} from "./bundle.js";

describe("audit bundle verifier", () => {
  it("canonicalizes JSON according to RFC 8785", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson([3, 2, 1])).toBe("[3,2,1]");
    expect(canonicalizeJson({ empty: {}, nested: { z: true, a: null } })).toBe(
      '{"empty":{},"nested":{"a":null,"z":true}}',
    );
  });

  it("computes the canonical event hash matching test vectors", async () => {
    const validBundle = validFixture.bundle as AuditBundle;
    const firstEvent = validBundle.events[0]?.event;
    if (!firstEvent) throw new Error("Missing event in fixture");

    const hash = await computeCanonicalEventHash(firstEvent);
    expect(hash).toBe(firstEvent.hash);
  });

  it("passes all checks on valid-two-events bundle", async () => {
    const checks = await verifyAuditBundle(validFixture.bundle);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.some((c) => c.name === "canonical event hashes")).toBe(true);
    expect(checks.some((c) => c.name === "hash chain")).toBe(true);
    expect(checks.some((c) => c.name === "Merkle inclusion proofs")).toBe(true);
    expect(checks.some((c) => c.name === "batch ranges and roots")).toBe(true);
    expect(checks.some((c) => c.name === "anchor reference")).toBe(true);
  });

  it("fails canonical event hash on tampered payload", async () => {
    const checks = await verifyAuditBundle(tamperedPayloadFixture.bundle);
    const failed = checks.find((c) => !c.ok);
    expect(failed).toBeDefined();
    expect(failed?.reasonCode).toBe(AuditReasonCode.EVENT_HASH_INVALID);
  });

  it("fails Merkle inclusion on tampered proof path", async () => {
    const checks = await verifyAuditBundle(tamperedProofFixture.bundle);
    const failed = checks.find((c) => !c.ok);
    expect(failed).toBeDefined();
    expect(failed?.reasonCode).toBe(AuditReasonCode.PROOF_INVALID);
  });

  it("fails batch range on overlapping or malformed ranges", async () => {
    const checks = await verifyAuditBundle(malformedRangeFixture.bundle);
    const failed = checks.find((c) => !c.ok);
    expect(failed).toBeDefined();
    expect(failed?.reasonCode).toBe(AuditReasonCode.BATCH_INVALID);
  });

  it("fails anchor check on tampered anchor root", async () => {
    const checks = await verifyAuditBundle(tamperedAnchorFixture.bundle);
    const failed = checks.find((c) => !c.ok);
    expect(failed).toBeDefined();
    expect(failed?.reasonCode).toBe(AuditReasonCode.ANCHOR_INVALID);
  });

  it("exports bundle to CSV format with all headers", () => {
    const csv = exportAuditBundleCsv(validFixture.bundle as AuditBundle);
    expect(csv).toContain("fund_id,sequence,event_type,occurred_at,event_hash");
    expect(csv).toContain("00000000-0000-4000-8000-000000000001");
    expect(csv.split("\n").length).toBe(3); // Header + 2 events
  });
});
