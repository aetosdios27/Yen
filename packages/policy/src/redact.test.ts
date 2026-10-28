import { type Paise, type PseudonymId, paise, parsePseudonymId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  type DonationRecord,
  type ExpenseRecord,
  maskNameToInitials,
  type Redacted,
  RedactionError,
  redact,
} from "./redact.js";
import type { FundRole } from "./roles.js";

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
    amountPaise: paise(500000),
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
    amountPaise: paise(100000),
    donorDisplayName: "Sunil Kumar",
    donorPhone: "+919876543210",
    donorEmail: "sunil@example.com",
    donorPseudonymId: asPseudonymId("psn_00000000-0000-0000-0000-000000000002"),
    bankTransactionId: "UPI/1234567890/HDFC/ref",
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  it("requires branded integer paise in both record types", () => {
    // @ts-expect-error An unvalidated fractional number is not Paise.
    const expense: ExpenseRecord = { ...expenseRecord, amountPaise: 1.5 };
    // @ts-expect-error A wire string is not Paise.
    const donation: DonationRecord = { ...donationRecord, amountPaise: "100" };
    expect([expense, donation]).toHaveLength(2);
  });

  it("enforces brand requirement at type level (R7)", () => {
    // @ts-expect-error Raw unredacted record must not be assignable to Redacted<T> without brand
    const _unredactedAssign: Redacted<ExpenseRecord> = expenseRecord;
    expect(_unredactedAssign).toBeDefined();
  });

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
    it("keeps even the donor's own donation pseudonymous", () => {
      const selfViewer = {
        id: "psn_00000000-0000-0000-0000-000000000002",
        role: "donor" as const,
      };
      const result = redact(selfViewer, donationRecord);
      expect(result.donorDisplayName).toBeUndefined();
      expect(result.donorPhone).toBeUndefined();
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

    it("masks requester display name to initials when donor views someone else's expense (R3/Greptile)", () => {
      const otherDonorViewer = {
        id: "psn_00000000-0000-0000-0000-000000000099",
        role: "donor" as const,
      };
      const result = redact(otherDonorViewer, expenseRecord);
      expect(result.requesterDisplayName).toBe("A. S.");
      expect(result.payeeName).toBe("V. C. P. L.");
      expect(result.notes).toBeUndefined();
      expect(result.evidence?.[0]?.contentSha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(result.evidence?.[0]?.fileUrl).toBeUndefined();
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

  describe("Field allowlists & unknown PII stripping (R3)", () => {
    const extraPiiPayload = {
      name: "Jane Doe",
      phone: "+919876543210",
      email: "jane@example.com",
      vpa: "jane@upi",
      bankAccount: "123456789012",
      ifsc: "HDFC0001234",
    };

    const nonStaffViewers = [
      { name: "public viewer", viewer: { role: "public" as const } },
      {
        name: "donor viewer",
        viewer: { id: "psn_00000000-0000-0000-0000-000000000099", role: "donor" as const },
      },
    ];

    it.each(nonStaffViewers)("drops extra PII fields from fund record for $name", ({ viewer }) => {
      const wrappedFundWithPii = {
        kind: "fund" as const,
        fund: {
          owner: "user-1",
          ...extraPiiPayload,
          fund: {
            id: "fund-1",
            name: "Festival 2026",
            createdAt: "2026-10-27T12:00:00.000Z",
            phone: extraPiiPayload.phone,
            email: extraPiiPayload.email,
            vpa: extraPiiPayload.vpa,
            bankAccount: extraPiiPayload.bankAccount,
            ifsc: extraPiiPayload.ifsc,
          },
        },
      };

      const result = redact(viewer, wrappedFundWithPii);
      expect(result.id).toBe("fund-1");
      expect(result.name).toBe("Festival 2026");
      expect(result.createdAt).toBe("2026-10-27T12:00:00.000Z");

      // Verify all extra PII fields are completely dropped
      expect(result).not.toHaveProperty("owner");
      expect(result).not.toHaveProperty("phone");
      expect(result).not.toHaveProperty("email");
      expect(result).not.toHaveProperty("vpa");
      expect(result).not.toHaveProperty("bankAccount");
      expect(result).not.toHaveProperty("ifsc");
    });

    it.each(nonStaffViewers)(
      "drops extra PII fields from expense record for $name",
      ({ viewer }) => {
        const expenseWithPii = {
          ...expenseRecord,
          ...extraPiiPayload,
        };

        const result = redact(viewer, expenseWithPii);
        expect(result.expenseId).toBe("exp-1");
        expect(result.fundId).toBe("fund-1");
        expect(result.amountPaise).toBe(paise(500000));

        // Verify all extra PII fields are completely dropped
        expect(result).not.toHaveProperty("name");
        expect(result).not.toHaveProperty("phone");
        expect(result).not.toHaveProperty("email");
        expect(result).not.toHaveProperty("vpa");
        expect(result).not.toHaveProperty("bankAccount");
        expect(result).not.toHaveProperty("ifsc");
      },
    );

    it.each(nonStaffViewers)(
      "drops extra PII fields from donation record for $name",
      ({ viewer }) => {
        const donationWithPii = {
          ...donationRecord,
          ...extraPiiPayload,
        };

        const result = redact(viewer, donationWithPii);
        expect(result.donationId).toBe("don-1");
        expect(result.fundId).toBe("fund-1");
        expect(result.donorPseudonymId).toBe(donationRecord.donorPseudonymId);

        // Verify all extra PII fields are completely dropped
        expect(result).not.toHaveProperty("name");
        expect(result).not.toHaveProperty("phone");
        expect(result).not.toHaveProperty("email");
        expect(result).not.toHaveProperty("vpa");
        expect(result).not.toHaveProperty("bankAccount");
        expect(result).not.toHaveProperty("ifsc");
      },
    );

    it("rejects unsupported record shapes with RedactionError instead of branding them (R3)", () => {
      const unsupported = {
        name: "Jane Doe",
        phone: "123",
        vpa: "jane@bank",
      };

      expect(() => redact({ role: "public" }, unsupported)).toThrow(RedactionError);
      expect(() => redact({ role: "donor" }, unsupported)).toThrow(RedactionError);
      expect(() => redact({ role: "owner" }, unsupported)).toThrow(RedactionError);
    });
  });
});

describe("Output allowlists and money validation (R3)", () => {
  const OTHER_DONOR = "psn_00000000-0000-0000-0000-000000000099";
  const EXTRA_PII = {
    name: "Jane Doe",
    phone: "+919000000001",
    email: "jane@example.com",
    vpa: "jane@bank",
    bankAccount: "123456789012",
    ifsc: "HDFC0001234",
  };
  const LEAKED_VALUES = Object.values(EXTRA_PII);

  const expenseBase: ExpenseRecord = {
    expenseId: "exp-9",
    fundId: "fund-9",
    amountPaise: paise(250000),
    payeeName: "Vendor Corporation Private Limited",
    requesterDisplayName: "Aarav Sharma",
    requesterPseudonymId: asPseudonymId("psn_00000000-0000-0000-0000-000000000001"),
    evidence: [
      {
        evidenceId: "ev-9",
        contentSha256: "a".repeat(64),
        fileUrl: "https://storage.internal.yen/bills/x.pdf",
        filename: "x.pdf",
        mimeType: "application/pdf",
      },
    ],
    notes: "internal note",
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  const donationBase: DonationRecord = {
    donationId: "don-9",
    fundId: "fund-9",
    amountPaise: paise(1000),
    donorDisplayName: "Sunil Kumar",
    donorPhone: "+919876543210",
    donorEmail: "sunil@example.com",
    donorPseudonymId: asPseudonymId("psn_00000000-0000-0000-0000-000000000002"),
    bankTransactionId: "UPI/9/HDFC/ref",
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  const fundWrapped = {
    kind: "fund" as const,
    fund: {
      owner: "user-9",
      fund: { id: "fund-9", name: "Relief 2026", createdAt: "2026-10-27T12:00:00.000Z" },
      ...EXTRA_PII,
    },
  };

  const nonStaffViewers = [
    { label: "public", viewer: { role: "public" as const } },
    { label: "donor (someone else)", viewer: { id: OTHER_DONOR, role: "donor" as const } },
  ];

  const EXPENSE_KEYS = [
    "expenseId",
    "fundId",
    "amountPaise",
    "payeeName",
    "requesterDisplayName",
    "requesterPseudonymId",
    "evidence",
    "notes",
    "createdAt",
  ];
  const DONATION_KEYS = [
    "donationId",
    "fundId",
    "amountPaise",
    "donorPseudonymId",
    "donorDisplayName",
    "donorPhone",
    "donorEmail",
    "bankTransactionId",
    "createdAt",
  ];
  const FUND_KEYS = ["id", "name", "targetPaise", "createdAt"];

  function presentKeys(obj: object): string[] {
    return Object.entries(obj)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
  }

  function caughtError(fn: () => unknown): unknown {
    try {
      fn();
    } catch (error) {
      return error;
    }
    return undefined;
  }

  describe.each(nonStaffViewers)("non-staff viewer: $label", ({ viewer }) => {
    it("returns only allowlisted expense fields and hash-only evidence, dropping extra PII", () => {
      const result = redact(viewer, { ...expenseBase, ...EXTRA_PII });
      expect(presentKeys(result).every((key) => EXPENSE_KEYS.includes(key))).toBe(true);
      expect(presentKeys(result.evidence?.[0] ?? {}).sort()).toEqual(["contentSha256"].sort());
      const serialized = JSON.stringify(result);
      for (const leaked of LEAKED_VALUES) {
        expect(serialized).not.toContain(leaked);
      }
      expect(serialized).not.toContain("Aarav Sharma");
      expect(serialized).not.toContain("Vendor Corporation");
      expect(serialized).not.toContain("storage.internal.yen");
    });

    it("returns only allowlisted donation fields with no bank or contact details", () => {
      const result = redact(viewer, { ...donationBase, ...EXTRA_PII });
      expect(presentKeys(result).every((key) => DONATION_KEYS.includes(key))).toBe(true);
      const serialized = JSON.stringify(result);
      for (const leaked of LEAKED_VALUES) {
        expect(serialized).not.toContain(leaked);
      }
      for (const private_ of [
        "Sunil Kumar",
        "+919876543210",
        "sunil@example.com",
        "UPI/9/HDFC/ref",
      ]) {
        expect(serialized).not.toContain(private_);
      }
    });

    it("returns only the fund view fields for a wrapped fund carrying PII", () => {
      const result = redact(viewer, fundWrapped);
      expect(presentKeys(result).every((key) => FUND_KEYS.includes(key))).toBe(true);
      expect(JSON.stringify(result)).not.toContain("user-9");
      for (const leaked of LEAKED_VALUES) {
        expect(JSON.stringify(result)).not.toContain(leaked);
      }
    });
  });

  it("masks the requester's name even for a donor who is the requester", () => {
    const requesterViewer = {
      id: "psn_00000000-0000-0000-0000-000000000001",
      role: "donor" as const,
    };
    const result = redact(requesterViewer, expenseBase);
    expect(result.requesterDisplayName).toBe("A. S.");
  });

  it("keeps the full record for a staff viewer", () => {
    const result = redact({ role: "auditor" }, { ...expenseBase, ...EXTRA_PII });
    expect(result.requesterDisplayName).toBe("Aarav Sharma");
    expect(result.evidence?.[0]?.fileUrl).toBe("https://storage.internal.yen/bills/x.pdf");
  });

  it.each([
    ["1.5", 1.5],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["beyond safe integer", Number.MAX_SAFE_INTEGER + 1],
    ["string", "5000"],
    ["bigint", 5000n],
    ["missing", undefined],
  ])("rejects a %s expense amount with INVALID_AMOUNT for every viewer", (_label, bad) => {
    for (const viewer of [
      { role: "public" as const },
      { role: "donor" as const },
      { role: "owner" as const },
    ]) {
      const error = caughtError(() =>
        redact(viewer, { ...expenseBase, amountPaise: bad as unknown as Paise }),
      );
      expect(error).toBeInstanceOf(RedactionError);
      expect((error as RedactionError).code).toBe("INVALID_AMOUNT");
    }
  });

  it.each([1.5, -1, Number.NaN, "1000"])(
    "rejects donation amount %s with INVALID_AMOUNT",
    (bad) => {
      const error = caughtError(() =>
        redact({ role: "owner" }, { ...donationBase, amountPaise: bad as unknown as Paise }),
      );
      expect((error as RedactionError).code).toBe("INVALID_AMOUNT");
    },
  );

  it("accepts a zero amount, which is a safe non-negative integer", () => {
    expect(redact({ role: "public" }, { ...expenseBase, amountPaise: paise(0) }).amountPaise).toBe(
      0,
    );
  });

  it.each(["1.5", "-1", "12abc", "", 100])(
    "rejects fund targetPaise %j with INVALID_AMOUNT",
    (bad) => {
      const fund = { id: "fund-9", name: "Relief", targetPaise: bad };
      const error = caughtError(() => redact({ role: "public" }, fund));
      expect((error as RedactionError).code).toBe("INVALID_AMOUNT");
    },
  );

  it("keeps a canonical targetPaise string", () => {
    const result = redact(
      { role: "public" },
      { id: "fund-9", name: "Relief", targetPaise: "9007199254740993" },
    );
    expect(result.targetPaise).toBe("9007199254740993");
  });

  it("rejects a non-string payee name instead of passing it through", () => {
    const error = caughtError(() =>
      redact({ role: "public" }, { ...expenseBase, payeeName: 12345 as unknown as string }),
    );
    expect(error).toBeInstanceOf(RedactionError);
  });

  it("tags unsupported record shapes with UNSUPPORTED_RECORD_SHAPE", () => {
    const error = caughtError(() =>
      redact({ role: "public" }, { name: "Jane Doe", vpa: "jane@bank" }),
    );
    expect(error).toBeInstanceOf(RedactionError);
    expect((error as RedactionError).code).toBe("UNSUPPORTED_RECORD_SHAPE");
  });

  it("treats a missing or malformed viewer as public", () => {
    const result = redact(undefined as unknown as { role: "owner" }, donationBase);
    expect(result.donorDisplayName).toBeUndefined();
    expect(result.bankTransactionId).toBeUndefined();
  });
});

describe("Evidence redaction with and without evidenceId for each viewer class", () => {
  const evidenceWithId = [
    {
      evidenceId: "ev-100",
      contentSha256: "b".repeat(64),
      fileUrl: "https://storage.internal.yen/bills/invoice-100.pdf",
      filename: "invoice-100.pdf",
      mimeType: "application/pdf",
    },
  ];

  const evidenceWithoutId = [
    {
      contentSha256: "c".repeat(64),
      fileUrl: "https://storage.internal.yen/bills/invoice-101.pdf",
      filename: "invoice-101.pdf",
      mimeType: "application/pdf",
    },
  ];

  const baseExpense: ExpenseRecord = {
    expenseId: "exp-100",
    fundId: "fund-100",
    amountPaise: paise(50000),
    payeeName: "Vendor Corp",
    requesterDisplayName: "Jane Doe",
    createdAt: "2026-10-27T12:00:00.000Z",
  };

  const viewers: Array<{ role: FundRole; label: string; isStaff: boolean }> = [
    { role: "public", label: "public", isStaff: false },
    { role: "donor", label: "donor", isStaff: false },
    { role: "owner", label: "staff (owner)", isStaff: true },
    { role: "treasurer", label: "staff (treasurer)", isStaff: true },
    { role: "approver", label: "staff (approver)", isStaff: true },
    { role: "auditor", label: "staff (auditor)", isStaff: true },
  ];

  describe.each(viewers)("$label viewer", ({ role, isStaff }) => {
    it("redacts evidence with evidenceId correctly", () => {
      const exp: ExpenseRecord = { ...baseExpense, evidence: evidenceWithId };
      const redacted = redact({ role }, exp);
      expect(redacted.evidence).toHaveLength(1);
      const ev = redacted.evidence?.[0];
      expect(ev?.contentSha256).toBe("b".repeat(64));

      if (isStaff) {
        expect(ev?.evidenceId).toBe("ev-100");
        expect(ev?.fileUrl).toBe("https://storage.internal.yen/bills/invoice-100.pdf");
        expect(ev?.filename).toBe("invoice-100.pdf");
        expect(ev?.mimeType).toBe("application/pdf");
      } else {
        expect(ev?.evidenceId).toBeUndefined();
        expect(ev?.fileUrl).toBeUndefined();
        expect(ev?.filename).toBeUndefined();
        expect(ev?.mimeType).toBeUndefined();
        expect(Object.keys(ev ?? {})).toEqual(["contentSha256"]);
      }
    });

    it("redacts evidence without evidenceId correctly", () => {
      const exp: ExpenseRecord = { ...baseExpense, evidence: evidenceWithoutId };
      const redacted = redact({ role }, exp);
      expect(redacted.evidence).toHaveLength(1);
      const ev = redacted.evidence?.[0];
      expect(ev?.contentSha256).toBe("c".repeat(64));

      if (isStaff) {
        expect(ev?.evidenceId).toBeUndefined();
        expect(ev?.fileUrl).toBe("https://storage.internal.yen/bills/invoice-101.pdf");
        expect(ev?.filename).toBe("invoice-101.pdf");
        expect(ev?.mimeType).toBe("application/pdf");
      } else {
        expect(ev?.evidenceId).toBeUndefined();
        expect(ev?.fileUrl).toBeUndefined();
        expect(ev?.filename).toBeUndefined();
        expect(ev?.mimeType).toBeUndefined();
        expect(Object.keys(ev ?? {})).toEqual(["contentSha256"]);
      }
    });
  });
});
