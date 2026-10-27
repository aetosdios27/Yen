import { type PseudonymId, parsePseudonymId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { type DonationRecord, type ExpenseRecord, maskNameToInitials, redact } from "./redact.js";

function asPseudonymId(id: string): PseudonymId {
  const parsed = parsePseudonymId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("maskNameToInitials", () => {
  it.each([
    ["Jane Doe", "J. D."],
    ["Aarav Sharma", "A. S."],
    ["Mohandas Karamchand Gandhi", "M. K. G."],
    ["Alice", "A."],
    ["  Bob   Marley  ", "B. M."],
    ["", ""],
  ])("masks %j to %j", (input, expected) => {
    expect(maskNameToInitials(input)).toBe(expected);
  });
});

describe("Field-level redaction (redact)", () => {
  const expenseRecord: ExpenseRecord = {
    expenseId: "exp-1",
    fundId: "fund-1",
    amountPaise: "500000",
    payeeName: "Vendor Corporation Private Limited",
    requesterDisplayName: "Aarav Sharma",
    requesterPseudonymId: asPseudonymId("psn_00000000-0000-0000-0000-000000000001"),
    notes: "Confidential internal committee note",
    evidence: [
      {
        evidenceId: "ev-1",
        contentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        fileUrl: "https://storage.internal.yen/bills/secret-invoice.pdf",
        filename: "secret-invoice.pdf",
        mimeType: "application/pdf",
      },
    ],
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  const donationRecord: DonationRecord = {
    donationId: "don-1",
    fundId: "fund-1",
    amountPaise: "100000",
    donorDisplayName: "Sunil Kumar",
    donorPhone: "+919876543210",
    donorEmail: "sunil@example.com",
    donorPseudonymId: asPseudonymId("psn_00000000-0000-0000-0000-000000000002"),
    bankTransactionId: "UPI/1234567890/HDFC/ref",
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  describe("Public viewer", () => {
    const publicViewer = { role: "public" as const };

    it("masks expense names to initials and bills/evidence to hash-only", () => {
      const result = redact(publicViewer, expenseRecord);

      // Names masked to initials
      expect(result.payeeName).toBe("V. C. P. L.");
      expect(result.requesterDisplayName).toBe("A. S.");

      // Evidence hash-only
      expect(result.evidence).toBeDefined();
      expect(result.evidence?.length).toBe(1);
      expect(result.evidence?.[0]?.contentSha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(result.evidence?.[0]?.fileUrl).toBeUndefined();
      expect(result.evidence?.[0]?.filename).toBeUndefined();

      // Notes redacted
      expect(result.notes).toBeUndefined();
    });

    it("ensures donors are strictly pseudonymous to the public (PII and bank linkages stripped)", () => {
      const result = redact(publicViewer, donationRecord);

      // Pseudonym ID preserved
      expect(result.donorPseudonymId).toBe("psn_00000000-0000-0000-0000-000000000002");

      // Personal identifying details stripped
      expect(result.donorDisplayName).toBeUndefined();
      expect(result.donorPhone).toBeUndefined();
      expect(result.donorEmail).toBeUndefined();
      expect(result.bankTransactionId).toBeUndefined();
    });
  });

  describe("Donor viewer", () => {
    it("preserves donor's own identifying details when viewing own donation", () => {
      const selfViewer = {
        id: "psn_00000000-0000-0000-0000-000000000002",
        role: "donor" as const,
      };
      const result = redact(selfViewer, donationRecord);
      expect(result.donorDisplayName).toBe("Sunil Kumar");
      expect(result.donorPhone).toBe("+919876543210");
    });

    it("strips personal identifying details when viewing another donor's donation", () => {
      const otherDonorViewer = {
        id: "psn_00000000-0000-0000-0000-000000000099",
        role: "donor" as const,
      };
      const result = redact(otherDonorViewer, donationRecord);
      expect(result.donorPseudonymId).toBe("psn_00000000-0000-0000-0000-000000000002");
      expect(result.donorDisplayName).toBeUndefined();
      expect(result.donorPhone).toBeUndefined();
    });
  });

  describe("Staff viewer (owner, treasurer, approver, auditor)", () => {
    it("preserves full record details for staff members", () => {
      const ownerViewer = { role: "owner" as const };
      const expResult = redact(ownerViewer, expenseRecord);
      expect(expResult.payeeName).toBe("Vendor Corporation Private Limited");
      expect(expResult.notes).toBe("Confidential internal committee note");
      expect(expResult.evidence?.[0]?.fileUrl).toBe(
        "https://storage.internal.yen/bills/secret-invoice.pdf",
      );

      const donResult = redact(ownerViewer, donationRecord);
      expect(donResult.donorDisplayName).toBe("Sunil Kumar");
      expect(donResult.donorPhone).toBe("+919876543210");
      expect(donResult.bankTransactionId).toBe("UPI/1234567890/HDFC/ref");
    });
  });

  describe("Wrapped API Fund record", () => {
    it("extracts and marks fund view as redacted", () => {
      const wrapped = {
        kind: "fund" as const,
        fund: {
          owner: "user-1",
          fund: {
            id: "fund-1",
            name: "Festival 2026",
            createdAt: "2026-10-27T12:00:00.000Z",
          },
        },
      };

      const result = redact({ role: "owner" }, wrapped);
      expect(result).toEqual({
        id: "fund-1",
        name: "Festival 2026",
        createdAt: "2026-10-27T12:00:00.000Z",
      });
    });
  });
});
