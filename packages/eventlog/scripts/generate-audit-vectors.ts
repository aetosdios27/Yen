import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Event, makeNextEvent } from "@yen/eventlog";
import { buildIntervalTree, type FundId, fromHex, hash32, salt32, toHex } from "@yen/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../verifier/vectors/v1");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function required<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`missing fixture value at ${index}`);
  return value;
}
const fund = "00000000-0000-4000-8000-000000000001";
const actor = "psn_00000000-0000-4000-8000-000000000002";
const events: Event[] = [];
let prior: Event | null = null;
for (let seq = 1; seq <= 2; seq++) {
  prior = await makeNextEvent(prior, {
    fund_id: fund,
    type: "fund.created",
    version: 1,
    actor,
    occurred_at: `2026-01-01T00:00:0${seq}.000Z`,
    payload: { org_id: "00000000-0000-4000-8000-000000000003", visibility: "public" },
  } as Parameters<typeof makeNextEvent>[1]);
  events.push(prior);
}
const salts = ["11".repeat(32), "22".repeat(32)];
const tree = await buildIntervalTree([
  {
    fundId: fund as FundId,
    latestEventHash: hash32(fromHex(required(events, 1).hash)),
    events: events.map((event, i) => ({
      seq: event.seq,
      eventHash: hash32(fromHex(event.hash)),
      salt: salt32(fromHex(required(salts, i))),
    })),
  },
]);
const proofs = await Promise.all(events.map((event) => tree.prove(fund as FundId, event.seq)));
const valid = {
  format: "yen/audit-bundle/v1",
  fund_id: fund,
  chain: { start_seq: 0, start_hash: "0".repeat(64) },
  events: events.map((event, i) => {
    const proof = required(proofs, i);
    return {
      event,
      salt: required(salts, i),
      latest_event_hash: toHex(proof.latestEventHash),
      eventProof: { ...proof.eventProof, path: proof.eventProof.path.map(toHex) },
      fundProof: { ...proof.fundProof, path: proof.fundProof.path.map(toHex) },
    };
  }),
  roots: [
    {
      start_seq: 1,
      end_seq: 2,
      event_root: toHex(required(tree.fundRoots, 0)),
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
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const vectors: {
  name: string;
  bundle: unknown;
  expected: { valid: boolean; reason_code: string | null };
}[] = [];
const add = (name: string, bundle: unknown, code: string | null) =>
  vectors.push({ name, bundle, expected: { valid: code === null, reason_code: code } });
add("valid-two-events", valid, null);
const malformed = clone(valid);
malformed.format = "yen/audit-bundle/v2";
add("malformed-format", malformed, "FORMAT_INVALID");
const truncated = clone(valid);
truncated.events.shift();
add("truncated-first-event", truncated, "CHAIN_INVALID");
const tampered = clone(valid);
required(tampered.events, 0).event.payload.visibility = "private";
add("tampered-event-payload", tampered, "EVENT_HASH_INVALID");
const proof = clone(valid);
required(proof.events, 0).eventProof.path = ["ff".repeat(32)];
add("tampered-inclusion-path", proof, "PROOF_INVALID");
const ranges = clone(valid);
ranges.roots.push(clone(required(ranges.roots, 0)));
add("malformed-batch-range", ranges, "BATCH_INVALID");
const anchor = clone(valid);
anchor.anchor.root = "ff".repeat(32);
add("tampered-anchor-root", anchor, "ANCHOR_INVALID");
await mkdir(root, { recursive: true });
for (const vector of vectors)
  await writeFile(resolve(root, `${vector.name}.json`), `${JSON.stringify(vector, null, 2)}\n`);
await writeFile(
  resolve(root, "index.json"),
  `${JSON.stringify({ version: 1, vectors: vectors.map(({ name, expected }) => ({ file: `${name}.json`, ...expected })) }, null, 2)}\n`,
);
const format = spawnSync("pnpm", ["exec", "biome", "format", "--write", root], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (format.status !== 0) throw new Error("Biome could not format generated vectors");
console.log(`Wrote ${vectors.length} audit bundle vectors to ${root}`);
