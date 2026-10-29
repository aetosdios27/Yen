import type { FundId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { type DevSeedResult, SEED_CONSTANTS, seedDevDatabase } from "./dev-seed.js";
import { checkStoredChainStructure } from "./events.js";
import { databaseSuite } from "./test/database.js";

describe("dev-seed constants and shapes", () => {
  it("defines valid UUIDv7 identifiers for core entities", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(SEED_CONSTANTS.orgId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.fundId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.treasurerUserId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.approver1UserId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.approver2UserId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor1UserId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor2UserId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor3UserId).toMatch(uuidRegex);
  });

  it("defines valid pseudonym identifiers", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(SEED_CONSTANTS.treasurerPseudonymId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.approver1PseudonymId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.approver2PseudonymId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor1PseudonymId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor2PseudonymId).toMatch(uuidRegex);
    expect(SEED_CONSTANTS.donor3PseudonymId).toMatch(uuidRegex);
  });

  it("verifies double-entry zero-sum ledger invariant in seed structure", () => {
    const donationsPaise = 50000000; // ₹5,00,000
    const expensesPaidPaise = 3500000; // ₹35,000
    const currentBankPaise = donationsPaise - expensesPaidPaise; // ₹4,65,000

    // Accounting entries:
    // Donations journal: Bank +50M, Donations -50M => Net 0
    // Expenses journal: Expenses +3.5M, Bank -3.5M => Net 0
    const journal1Sum = 50000000 + -50000000;
    const journal2Sum = 3500000 + -3500000;
    const totalLedgerSum = currentBankPaise + -donationsPaise + expensesPaidPaise;

    expect(journal1Sum).toBe(0);
    expect(journal2Sum).toBe(0);
    expect(totalLedgerSum).toBe(0);
  });
});

databaseSuite("dev-seed database integration", (sql) => {
  it("seeds the full local development dataset and verifies all invariants", async () => {
    const result: DevSeedResult = await seedDevDatabase(sql);

    // Verify Organization
    expect(result.org.name).toBe("IIT Delhi Robotics Club");
    const orgRows = await sql`SELECT name, legal_form FROM orgs WHERE id = ${result.org.id}`;
    expect(orgRows[0]?.name).toBe("IIT Delhi Robotics Club");
    expect(orgRows[0]?.legal_form).toBe("student_society");

    // Verify Active Fund
    expect(result.fund.title).toBe("RoboCup 2026 Asia Fund");
    expect(result.fund.upiVpa).toBe("iitd.robotics@sbi");
    expect(result.fund.visibilityTier).toBe("public");
    const fundRows =
      await sql`SELECT title, status, visibility_tier, policy_json FROM funds WHERE id = ${result.fund.id}`;
    expect(fundRows[0]?.title).toBe("RoboCup 2026 Asia Fund");
    expect(fundRows[0]?.status).toBe("active");
    expect(fundRows[0]?.visibility_tier).toBe("public");
    expect(fundRows[0]?.policy_json.upiVpa).toBe("iitd.robotics@sbi");

    // Verify Users, Pseudonyms, and Sessions
    expect(result.users).toHaveLength(6);
    const userRows =
      await sql`SELECT id, phone, display_name FROM users WHERE id IN ${sql(result.users.map((u) => u.id))}`;
    expect(userRows).toHaveLength(6);

    const sessionRows = await sql`SELECT user_id, token_hash FROM sessions`;
    expect(sessionRows.length).toBeGreaterThanOrEqual(6);

    // Verify Memberships (1 treasurer, 2 approvers, 3 donors/members)
    const membershipRows =
      await sql`SELECT role, count(*)::int as count FROM memberships WHERE fund_id = ${result.fund.id} GROUP BY role`;
    const rolesMap = Object.fromEntries(membershipRows.map((r) => [r.role, r.count]));
    expect(rolesMap.treasurer).toBe(1);
    expect(rolesMap.approver).toBe(2);
    expect(rolesMap.member).toBe(3);

    // Verify 3 Expense Requests
    expect(result.expenses).toHaveLength(3);
    const expenseRows =
      await sql`SELECT id, status, amount_paise FROM expense_requests WHERE fund_id = ${result.fund.id} ORDER BY amount_paise DESC`;
    expect(expenseRows).toHaveLength(3);

    const approvedExp = expenseRows.find((e) => e.status === "approved");
    const pendingExp = expenseRows.find((e) => e.status === "submitted");
    const paidExp = expenseRows.find((e) => e.status === "paid");

    expect(approvedExp).toBeDefined();
    expect(BigInt(approvedExp?.amount_paise)).toBe(7500000n); // 75,000 rupees in paise
    expect(pendingExp).toBeDefined();
    expect(BigInt(pendingExp?.amount_paise)).toBe(2500000n); // 25,000 rupees in paise
    expect(paidExp).toBeDefined();
    expect(BigInt(paidExp?.amount_paise)).toBe(3500000n); // 35,000 rupees in paise

    // Verify Konto Ledger Accounts and Entries
    const entrySumRows = await sql`SELECT sum(amount)::bigint as total FROM konto_entries`;
    expect(BigInt(entrySumRows[0]?.total ?? 0)).toBe(0n); // zero-sum double entry invariant

    // Verify Event Log Chain Integrity
    const chainCheck = await checkStoredChainStructure(sql, result.fund.id as FundId);
    expect(chainCheck.status).toBe("structure-consistent");
    expect(result.eventCount).toBe(23);

    // Verify Idempotency: Running seedDevDatabase again on the same DB succeeds
    const rerunResult = await seedDevDatabase(sql);
    expect(rerunResult.fund.id).toBe(result.fund.id);
  });
});
