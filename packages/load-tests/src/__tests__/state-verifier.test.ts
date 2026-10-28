import { describe, expect, it } from "vitest";
import { MemoryStateVerifier } from "../state-verifier.js";

describe("MemoryStateVerifier", () => {
  it("initializes with zero pledges", async () => {
    const verifier = new MemoryStateVerifier();
    expect(await verifier.getPledgeCount()).toBe(0);
  });

  it("records pledges and counts by fundId", async () => {
    const verifier = new MemoryStateVerifier();
    const fundA = "00000000-0000-4000-8000-000000000001";
    const fundB = "00000000-0000-4000-8000-000000000002";

    await verifier.recordPledge({
      id: "pledge-1",
      fund_id: fundA,
      amount_paise: "50000",
      utr: "123456789012",
      status: "pledged",
      created_at: new Date(),
    });

    await verifier.recordPledge({
      id: "pledge-2",
      fund_id: fundA,
      amount_paise: "100000",
      utr: "123456789013",
      status: "pledged",
      created_at: new Date(),
    });

    await verifier.recordPledge({
      id: "pledge-3",
      fund_id: fundB,
      amount_paise: "25000",
      utr: "123456789014",
      status: "pledged",
      created_at: new Date(),
    });

    expect(await verifier.getPledgeCount()).toBe(3);
    expect(await verifier.getPledgeCount(fundA)).toBe(2);
    expect(await verifier.getPledgeCount(fundB)).toBe(1);
  });

  it("verifies expected count correctly", async () => {
    const verifier = new MemoryStateVerifier();
    const fundId = "00000000-0000-4000-8000-000000000001";

    await verifier.recordPledge({
      id: "pledge-1",
      fund_id: fundId,
      amount_paise: "50000",
      utr: "123456789012",
      status: "pledged",
      created_at: new Date(),
    });

    const successResult = await verifier.verifyPledges(1, fundId);
    expect(successResult.passed).toBe(true);
    expect(successResult.discrepancy).toBe(0);

    const failResult = await verifier.verifyPledges(2, fundId);
    expect(failResult.passed).toBe(false);
    expect(failResult.discrepancy).toBe(-1);
  });

  it("resets pledges by fund or globally", async () => {
    const verifier = new MemoryStateVerifier();
    const fundA = "00000000-0000-4000-8000-000000000001";
    const fundB = "00000000-0000-4000-8000-000000000002";

    await verifier.recordPledge({
      id: "p1",
      fund_id: fundA,
      amount_paise: "1000",
      utr: "111111111111",
      status: "pledged",
      created_at: new Date(),
    });
    await verifier.recordPledge({
      id: "p2",
      fund_id: fundB,
      amount_paise: "2000",
      utr: "222222222222",
      status: "pledged",
      created_at: new Date(),
    });

    await verifier.reset(fundA);
    expect(await verifier.getPledgeCount(fundA)).toBe(0);
    expect(await verifier.getPledgeCount(fundB)).toBe(1);

    await verifier.reset();
    expect(await verifier.getPledgeCount()).toBe(0);
  });
});
