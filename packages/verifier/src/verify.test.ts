import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyAnchor, verifyBundle } from "./verify.js";

type Fixture = {
  events: {
    event: { payload: Record<string, unknown> };
    eventProof: { index: number; size: number; path: string[] };
  }[];
  roots: { start_seq: number; end_seq: number; global_root: string }[];
  anchor: { contract_address: string };
  [key: string]: unknown;
};

function item<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("fixture value missing");
  return value;
}

async function fixture(): Promise<Fixture> {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../vectors/v1/valid-two-events.json",
  );
  const vector = JSON.parse(await readFile(path, "utf8")) as { bundle: Fixture };
  return structuredClone(vector.bundle);
}

describe("standalone verifier published vectors", () => {
  it("accepts the published valid bundle", async () => {
    const checks = verifyBundle(await fixture());
    expect(
      checks.every((check) => check.ok),
      JSON.stringify(checks),
    ).toBe(true);
  });
  it("detects an edited event", async () => {
    const b = await fixture();
    item(b.events, 0).event.payload.visibility = "private";
    expect(verifyBundle(b).find((check) => !check.ok)?.reasonCode).toBe("EVENT_HASH_INVALID");
  });
  it("detects a deleted event", async () => {
    const b = await fixture();
    b.events.splice(0, 1);
    expect(verifyBundle(b).find((check) => !check.ok)?.reasonCode).toBe("CHAIN_INVALID");
  });
  it("detects swapped order", async () => {
    const b = await fixture();
    b.events.reverse();
    expect(verifyBundle(b).find((check) => !check.ok)?.reasonCode).toBe("CHAIN_INVALID");
  });
  it("detects a wrong root", async () => {
    const b = await fixture();
    item(b.roots, 0).global_root = "ff".repeat(32);
    expect(verifyBundle(b).find((check) => !check.ok)?.reasonCode).toBe("PROOF_INVALID");
  });
  it("detects a forged inclusion path", async () => {
    const b = await fixture();
    item(b.events, 0).eventProof = { ...item(b.events, 0).eventProof, path: ["ff".repeat(32)] };
    expect(verifyBundle(b).find((check) => !check.ok)?.reasonCode).toBe("PROOF_INVALID");
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
