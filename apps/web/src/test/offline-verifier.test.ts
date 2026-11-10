import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type AuditBundle,
  buildIntervalTree,
  computeCanonicalEventHash,
  fromHex,
  hash32,
  parseFundId,
  salt32,
  toHex,
} from "@yen/shared";
import { describe, expect, it } from "vitest";
import { generateOfflineVerifierScript } from "../lib/offline-script.js";

const execFileAsync = promisify(execFile);

async function createAuditBundleFixture(): Promise<AuditBundle> {
  const fundResult = parseFundId("00000000-0000-4000-8000-000000000010");
  if (!fundResult.ok) throw new Error(fundResult.error);
  const fundId = fundResult.value;
  const recordId = "00000000-0000-4000-8000-000000000020";

  const event = {
    fund_id: fundId,
    seq: 1,
    type: "expense.submitted",
    version: 1,
    actor: "psn_00000000-0000-4000-8000-000000000002",
    occurred_at: "2026-10-28T00:00:00.000Z",
    payload: { expense_id: recordId, amount_paise: 8500000 },
    prev_hash: "0".repeat(64),
    hash: "",
  };

  event.hash = await computeCanonicalEventHash(event);
  const salt = "11".repeat(32);

  const tree = await buildIntervalTree([
    {
      fundId,
      latestEventHash: hash32(fromHex(event.hash)),
      events: [{ seq: 1, eventHash: hash32(fromHex(event.hash)), salt: salt32(fromHex(salt)) }],
    },
  ]);

  const proof = await tree.prove(fundId, 1);
  const root = toHex(tree.root);
  const eventRoot = toHex(tree.fundRoots[0] ?? hash32(new Uint8Array(32)));

  return {
    format: "yen/audit-bundle/v1",
    fund_id: fundId,
    chain: { start_seq: 0, start_hash: "0".repeat(64) },
    events: [
      {
        event,
        salt,
        latest_event_hash: toHex(proof.latestEventHash),
        eventProof: {
          index: proof.eventProof.index,
          size: proof.eventProof.size,
          path: proof.eventProof.path.map(toHex),
        },
        fundProof: {
          index: proof.fundProof.index,
          size: proof.fundProof.size,
          path: proof.fundProof.path.map(toHex),
        },
      },
    ],
    roots: [
      {
        start_seq: 1,
        end_seq: 1,
        event_root: eventRoot,
        fund_count: 1,
        global_root: root,
      },
    ],
    anchor: {
      chain_id: 80002,
      contract_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      root,
      sequence: 1,
    },
  };
}

describe("Offline Verifier Script (verify-bundle.mjs)", () => {
  it("executes cleanly on standard Node and verifies valid bundle with exit code 0", async () => {
    const bundle = await createAuditBundleFixture();
    const script = generateOfflineVerifierScript();

    const dir = await mkdtemp(join(tmpdir(), "yen-verify-test-"));
    const scriptPath = join(dir, "verify-bundle.mjs");
    const bundlePath = join(dir, "bundle.json");

    try {
      await writeFile(scriptPath, script, "utf8");
      await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");

      const { stdout } = await execFileAsync("node", [scriptPath, bundlePath]);
      expect(stdout).toContain("ALL CRYPTOGRAPHIC CHECKS PASSED");
      expect(stdout).toContain("Event #1 [expense.submitted] sealed and verified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails and exits with code 1 when bundle event is tampered", async () => {
    const bundle = await createAuditBundleFixture();
    // Tamper payload
    const firstEvent = bundle.events[0];
    if (!firstEvent) throw new Error("Expected at least one event in fixture");
    firstEvent.event.payload.amount_paise = 1;

    const script = generateOfflineVerifierScript();

    const dir = await mkdtemp(join(tmpdir(), "yen-verify-test-"));
    const scriptPath = join(dir, "verify-bundle.mjs");
    const bundlePath = join(dir, "bundle.json");

    try {
      await writeFile(scriptPath, script, "utf8");
      await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");

      let failed = false;
      try {
        await execFileAsync("node", [scriptPath, bundlePath]);
      } catch (err: unknown) {
        failed = true;
        const execErr = err as { code: number; stdout: string; stderr: string };
        expect(execErr.code).toBe(1);
        expect(execErr.stderr).toContain("hash mismatch");
      }
      expect(failed).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
