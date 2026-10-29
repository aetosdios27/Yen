import { describe, expect, it } from "vitest";
import { sanitizePublicFund } from "./sanitizer";
import type { RawFundRecord } from "./types";

describe("sanitizePublicFund (security and privacy)", () => {
  const sensitiveRecord: RawFundRecord = {
    id: "fnd_test_privacy",
    name: "Clean Water Initiative",
    purpose: "Solar pumps and water filters for rural schools.",
    phone: "+919876543210",
    contact_phone: "+919123456789",
    bank_account_number: "98765432109876",
    ifsc_code: "HDFC0001234",
    org: {
      id: "org_clean_water",
      name: "Gram Vikas Trust",
      verified: true,
      legal_form: "Registered Trust",
      owner_id: "usr_internal_admin_secret_id_999",
      owner_phone: "+919888877777",
    },
    total_raised_paise: 20000000,
    total_spent_paise: 8000000,
    spending_categories: [
      { category: "equipment", amount_paise: 5000000 },
      { category: "logistics", amount_paise: 3000000 },
    ],
    timeline: [
      {
        id: "evnt_01",
        type: "donation",
        title: "Seed Grant",
        amount_paise: 20000000,
        donor_name: "Community Supporter",
        donor_phone: "+919999900000",
        donor_user_id: "usr_private_donor_uuid_1234",
      },
      {
        id: "evnt_02",
        type: "expense",
        title: "Solar Inverter Kit",
        amount_paise: 5000000,
        category: "equipment",
        approver_ids: ["usr_secret_approver_1", "usr_secret_approver_2", "usr_secret_approver_3"],
        evidence: {
          id: "evi_solar_inv",
          title: "Solar Inverter Bill",
          url: "https://evidence.yen.org/evi_solar_inv.pdf",
        },
      },
    ],
    upi_vpa: "gramvikas@upi",
    upi_payee_name: "Gram Vikas Trust",
  };

  it("completely strips all phone numbers from the public output", () => {
    const sanitized = sanitizePublicFund(sensitiveRecord);
    const json = JSON.stringify(sanitized);

    expect(json).not.toContain("+919876543210");
    expect(json).not.toContain("+919123456789");
    expect(json).not.toContain("+919888877777");
    expect(json).not.toContain("+919999900000");
  });

  it("completely strips internal user UUIDs and approver IDs from the public output", () => {
    const sanitized = sanitizePublicFund(sensitiveRecord);
    const json = JSON.stringify(sanitized);

    expect(json).not.toContain("usr_internal_admin_secret_id_999");
    expect(json).not.toContain("usr_private_donor_uuid_1234");
    expect(json).not.toContain("usr_secret_approver_1");
    expect(json).not.toContain("usr_secret_approver_2");
    expect(json).not.toContain("usr_secret_approver_3");
  });

  it("completely strips bank account numbers and IFSC codes", () => {
    const sanitized = sanitizePublicFund(sensitiveRecord);
    const json = JSON.stringify(sanitized);

    expect(json).not.toContain("98765432109876");
    expect(json).not.toContain("HDFC0001234");
  });

  it("accurately preserves approver count without revealing identities", () => {
    const sanitized = sanitizePublicFund(sensitiveRecord);
    const expenseEntry = sanitized.timeline.find((item) => item.id === "evnt_02");

    expect(expenseEntry?.verification?.approverCount).toBe(3);
  });

  it("calculates current balance exactly using safe integer paise arithmetic", () => {
    const sanitized = sanitizePublicFund(sensitiveRecord);

    expect(sanitized.money.totalRaised).toBe(20000000);
    expect(sanitized.money.totalSpent).toBe(8000000);
    expect(sanitized.money.currentBalance).toBe(12000000);
  });

  it("handles deficit / overspending without negative balance crashes", () => {
    const overspentRecord: RawFundRecord = {
      ...sensitiveRecord,
      total_raised_paise: 5000000,
      total_spent_paise: 8000000,
    };
    const sanitized = sanitizePublicFund(overspentRecord);

    expect(sanitized.money.currentBalance).toBe(0);
  });
});
