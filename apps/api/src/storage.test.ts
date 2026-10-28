import { describe, expect, it } from "vitest";
import { buildOpaqueEvidenceKey, sanitizeEvidenceFilename } from "./storage.js";

const fundId = "00000000-0000-4000-8000-000000000001";
const expenseId = "00000000-0000-4000-8000-000000000002";
const evidenceId = "00000000-0000-4000-8000-000000000003";

describe("evidence storage keys and filenames", () => {
  it("sanitizes path components and control characters from filenames", () => {
    expect(sanitizeEvidenceFilename("../../private/../receipt\u0000.pdf")).toBe("receipt.pdf");
    expect(sanitizeEvidenceFilename("../../")).toBe("evidence");
  });

  it("rejects traversal identifiers and untrusted nonces in storage keys", () => {
    expect(() => buildOpaqueEvidenceKey(fundId, "../../expense", evidenceId)).toThrow();
    expect(() => buildOpaqueEvidenceKey(fundId, expenseId, "../../evidence")).toThrow();
  });

  it("uses a fresh unguessable nonce for each key", () => {
    const first = buildOpaqueEvidenceKey(fundId, expenseId, evidenceId);
    const second = buildOpaqueEvidenceKey(fundId, expenseId, evidenceId);
    expect(first).not.toBe(second);
    expect(first).toMatch(/\/evidence\/00000000-0000-4000-8000-000000000003\/[a-f0-9]{32}$/);
  });
});
