import { type Event, makeNextEvent } from "@yen/eventlog";
import { buildIntervalTree, type FundId, fromHex, hash32, salt32, toHex } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { verifyAnchor, verifyBundle } from "./verify.js";

function item<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("fixture value missing");
  return value;
}

async function fixture() {
  const fund = "00000000-0000-4000-8000-000000000001";
  const actor = "psn_00000000-0000-4000-8000-000000000002";
  const events: Event[] = [];
  let previous: Event | null = null;
  for (let i = 1; i <= 2; i++) {
    const event = await makeNextEvent(previous, {
      fund_id: fund,
      type: "fund.created",
      version: 1,
      actor,
      occurred_at: `2026-01-01T00:00:0${i}.000Z`,
      payload: { org_id: "00000000-0000-4000-8000-000000000003", visibility: "public" },
    } as Parameters<typeof makeNextEvent>[1]);
    events.push(event);
    previous = event;
  }
  const salts = ["11".repeat(32), "22".repeat(32)];
  const tree = await buildIntervalTree([
    {
      fundId: fund as FundId,
      latestEventHash: hash32(fromHex(item(events, 1).hash)),
      events: events.map((event, i) => ({
        seq: event.seq,
        eventHash: hash32(fromHex(event.hash)),
        salt: salt32(fromHex(item(salts, i))),
      })),
    },
  ]);
  const proofs = await Promise.all(events.map((event) => tree.prove(fund as FundId, event.seq)));
  return {
    format: "yen/audit-bundle/v1",
    fund_id: fund,
    chain: { start_seq: 0, start_hash: "0".repeat(64) },
    events: events.map((event, i) => ({
      event,
      salt: salts[i],
      latest_event_hash: toHex(item(proofs, i).latestEventHash),
      eventProof: {
        ...item(proofs, i).eventProof,
        path: item(proofs, i).eventProof.path.map(toHex),
      },
      fundProof: {
        ...item(proofs, i).fundProof,
        path: item(proofs, i).fundProof.path.map(toHex),
      },
    })),
    roots: [
      {
        start_seq: 1,
        end_seq: 2,
        event_root: toHex(item(tree.fundRoots, 0)),
        fund_count: 1,
        global_root: toHex(tree.root),
      },
    ],
    anchor: {
      chain_id: 80002,
      contract_address: `0x${"aa".repeat(20)}`,
      tx_hash: `0x${"bb".repeat(32)}`,
      root: toHex(tree.root),
      sequence: 1,
    },
  };
}

describe("standalone verifier cross-checks", () => {
  it("agrees with @yen event and Merkle implementations", async () => {
    const checks = verifyBundle(await fixture());
    expect(
      checks.every((check) => check.ok),
      JSON.stringify(checks),
    ).toBe(true);
  });
  it("detects an edited event", async () => {
    const b = await fixture();
    const payload = item(b.events, 0).event.payload;
    if ("visibility" in payload) payload.visibility = "private";
    expect(verifyBundle(b).some((c) => c.name === "canonical event hash" && !c.ok)).toBe(true);
  });
  it("detects a deleted event", async () => {
    const b = await fixture();
    b.events.splice(0, 1);
    expect(verifyBundle(b).some((c) => c.name === "hash chain" && !c.ok)).toBe(true);
  });
  it("detects swapped order", async () => {
    const b = await fixture();
    b.events.reverse();
    expect(verifyBundle(b).some((c) => c.name === "hash chain" && !c.ok)).toBe(true);
  });
  it("detects a wrong root", async () => {
    const b = await fixture();
    item(b.roots, 0).global_root = "ff".repeat(32);
    expect(verifyBundle(b).some((c) => c.name === "Merkle inclusion" && !c.ok)).toBe(true);
  });
  it("detects a forged inclusion path", async () => {
    const b = await fixture();
    item(b.events, 0).eventProof = {
      ...item(b.events, 0).eventProof,
      path: ["ff".repeat(32)],
    };
    expect(verifyBundle(b).some((c) => c.name === "Merkle inclusion" && !c.ok)).toBe(true);
  });
  it("rejects a wrong RPC chain id", async () => {
    const b = await fixture();
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    try {
      expect(
        item(await verifyAnchor(b, "http://rpc.invalid", b.anchor.contract_address), 0).ok,
      ).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
