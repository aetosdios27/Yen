import { type PseudonymId, parsePseudonymId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { applyPolicyEvent, EVENTLOG_SCHEMA_GAP_REPORT, type PolicyEvent } from "./events.js";
import { DEFAULT_FUND_POLICY, type FundPolicy } from "./policy.js";

function asPseudonymId(id: string): PseudonymId {
  const parsed = parsePseudonymId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("applyPolicyEvent projection", () => {
  const initialPolicy: FundPolicy = {
    ...DEFAULT_FUND_POLICY,
    approvalQuorum: 2,
    objectionWindowHours: 24,
    visibilityTier: "private",
  };

  it("updates quorum and objection window on fund.policy_changed", () => {
    const event: PolicyEvent = {
      type: "fund.policy_changed",
      payload: {
        approval_quorum: 4,
        objection_window_hours: 72,
      },
    };

    const updated = applyPolicyEvent(initialPolicy, event);
    expect(updated.approvalQuorum).toBe(4);
    expect(updated.objectionWindowHours).toBe(72);
    expect(updated.visibilityTier).toBe("private"); // untouched
  });

  it("updates visibility tier on fund.visibility_changed", () => {
    const event: PolicyEvent = {
      type: "fund.visibility_changed",
      payload: {
        visibility: "public",
      },
    };

    const updated = applyPolicyEvent(initialPolicy, event);
    expect(updated.visibilityTier).toBe("public");
    expect(updated.approvalQuorum).toBe(2); // untouched
  });

  it("does not mutate fund policy on membership events", () => {
    const addEvent: PolicyEvent = {
      type: "member.added",
      payload: {
        member_id: asPseudonymId("psn_00000000-0000-0000-0000-000000000001"),
        role: "approver",
      },
    };

    const updated = applyPolicyEvent(initialPolicy, addEvent);
    expect(updated).toEqual(initialPolicy);
  });
});

describe("Eventlog Schema Gap Report", () => {
  it("documents known schema gaps for future eventlog v2", () => {
    expect(EVENTLOG_SCHEMA_GAP_REPORT["fund.policy_changed"].missingCapabilities[0]).toContain(
      "spend_thresholds",
    );
    expect(EVENTLOG_SCHEMA_GAP_REPORT["fund.visibility_changed"].missingCapabilities[0]).toContain(
      "donors visibility tier",
    );
    expect(EVENTLOG_SCHEMA_GAP_REPORT["member.added"].missingCapabilities[0]).toContain(
      "owner and auditor roles",
    );
  });
});
