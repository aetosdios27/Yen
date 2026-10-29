import { createHash } from "node:crypto";

const eventKeys = [
  "fund_id",
  "seq",
  "type",
  "version",
  "actor",
  "occurred_at",
  "payload",
  "prev_hash",
  "hash",
];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Proof = { index: number; size: number; path: string[] };
type Entry = {
  event: Record<string, Json>;
  salt: string;
  latest_event_hash: string;
  eventProof: Proof;
  fundProof: Proof;
};
type Bundle = {
  format: "yen/audit-bundle/v1";
  fund_id: string;
  chain: { start_seq: number; start_hash: string };
  events: Entry[];
  roots: {
    start_seq: number;
    end_seq: number;
    event_root: string;
    fund_count: number;
    global_root: string;
  }[];
  anchor: {
    chain_id: number;
    contract_address: string;
    tx_hash: string;
    root: string;
    sequence: number;
  };
};
export const ReasonCode = {
  FORMAT_INVALID: "FORMAT_INVALID",
  EVENT_HASH_INVALID: "EVENT_HASH_INVALID",
  CHAIN_INVALID: "CHAIN_INVALID",
  PROOF_INVALID: "PROOF_INVALID",
  BATCH_INVALID: "BATCH_INVALID",
  ANCHOR_INVALID: "ANCHOR_INVALID",
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];
export type Check = {
  name: string;
  ok: boolean;
  reasonCode?: ReasonCode;
  position?: number;
  detail?: string;
};

function canonical(value: Json): string {
  if (typeof value === "string" && !validUnicode(value))
    throw new Error("JCS rejects lone surrogates");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      if (!validUnicode(key)) throw new Error("JCS rejects lone surrogates in keys");
      return `${JSON.stringify(key)}:${canonical(value[key] as Json)}`;
    })
    .join(",")}}`;
}
function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function digest(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest();
}
function bytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("expected lowercase 32-byte hex");
  return Buffer.from(hex, "hex");
}
function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}
function u64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid count");
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}
function eventHash(event: Record<string, Json>): string {
  const unsigned = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== "hash"),
  ) as Json;
  return hex(
    digest(
      Buffer.from("yen/eventlog/event/v1\0", "utf8"),
      Buffer.from(canonical(unsigned), "utf8"),
    ),
  );
}
function leaf(salt: string, eventHashHex: string): Uint8Array {
  return digest(Buffer.from([0]), bytes(salt), bytes(eventHashHex));
}
function node(left: Uint8Array, right: Uint8Array): Uint8Array {
  return digest(Buffer.from([1]), left, right);
}
function inclusionRoot(proof: Proof, value: Uint8Array): Uint8Array | undefined {
  let { index, size } = proof;
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    index < 0 ||
    index >= size
  )
    return;
  let result = value;
  for (const siblingHex of proof.path) {
    if (size === 1) return;
    const sibling = bytes(siblingHex);
    if (index % 2 === 1 || index === size - 1) {
      result = node(sibling, result);
      while (index % 2 === 0 && index !== 0) {
        index = Math.floor(index / 2);
        size = Math.floor(size / 2);
      }
    } else result = node(result, sibling);
    index = Math.floor(index / 2);
    size = Math.floor(size / 2);
  }
  return size === 1 ? result : undefined;
}
function wrappedFundRoot(
  entry: Entry,
  fundId: string,
): { eventRoot: string; globalRoot: string; fundCount: number } {
  const leafHash = leaf(entry.salt, String(entry.event.hash));
  const eventRoot = inclusionRoot(entry.eventProof, leafHash);
  if (!eventRoot) throw new Error("invalid event inclusion path");
  const id = Buffer.from(fundId.replaceAll("-", ""), "hex");
  if (id.length !== 16) throw new Error("invalid fund id");
  const fingerprint = digest(Buffer.from([3]), id, bytes(entry.latest_event_hash));
  const fundLeaf = digest(Buffer.from([2]), u64(entry.eventProof.size), eventRoot, fingerprint);
  const globalTreeRoot = inclusionRoot(entry.fundProof, fundLeaf);
  if (!globalTreeRoot) throw new Error("invalid fund inclusion path");
  return {
    eventRoot: hex(eventRoot),
    globalRoot: hex(digest(Buffer.from([4]), u64(entry.fundProof.size), globalTreeRoot)),
    fundCount: entry.fundProof.size,
  };
}
function parseBundle(input: unknown): Bundle {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("bundle must be an object");
  const b = input as Partial<Bundle>;
  if (
    b.format !== "yen/audit-bundle/v1" ||
    !Array.isArray(b.events) ||
    !Array.isArray(b.roots) ||
    !b.anchor ||
    !b.chain
  )
    throw new Error("unsupported or malformed bundle");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(b.fund_id ?? ""))
    throw new Error("invalid fund_id");
  if (
    b.events.length === 0 ||
    !Number.isSafeInteger(b.chain.start_seq) ||
    b.chain.start_seq < 0 ||
    !/^[0-9a-f]{64}$/.test(b.chain.start_hash) ||
    !Number.isSafeInteger(b.anchor.chain_id) ||
    b.anchor.chain_id < 1 ||
    !Number.isSafeInteger(b.anchor.sequence) ||
    b.anchor.sequence < 1 ||
    !/^[0-9a-f]{64}$/.test(b.anchor.root)
  )
    throw new Error("invalid chain checkpoint or anchor metadata");
  for (const root of b.roots) {
    if (
      !Number.isSafeInteger(root.start_seq) ||
      !Number.isSafeInteger(root.end_seq) ||
      !Number.isSafeInteger(root.fund_count) ||
      root.fund_count < 1 ||
      !/^[0-9a-f]{64}$/.test(root.event_root) ||
      !/^[0-9a-f]{64}$/.test(root.global_root)
    )
      throw new Error("invalid root metadata");
  }
  return b as Bundle;
}
export function verifyBundle(input: unknown): Check[] {
  let b: Bundle;
  try {
    b = parseBundle(input);
  } catch (error) {
    return [
      {
        name: "bundle format",
        ok: false,
        reasonCode: ReasonCode.FORMAT_INVALID,
        detail: String(error),
      },
    ];
  }
  const checks: Check[] = [];
  let prevHash = b.chain.start_hash;
  let expectedSeq = b.chain.start_seq + 1;
  let previousTime = "";
  let eventHashesValid = true;
  let chainValid = true;
  for (let i = 0; i < b.events.length; i++) {
    const entry = required(b.events[i]);
    const event = entry.event;
    const hash = typeof event.hash === "string" ? event.hash : "";
    if (
      Object.keys(event).length !== eventKeys.length ||
      eventKeys.some((key) => !Object.hasOwn(event, key))
    ) {
      checks.push({
        name: "canonical event hash",
        ok: false,
        position: i,
        detail: "event envelope fields differ from v1",
      });
      eventHashesValid = false;
      break;
    }
    try {
      if (eventHash(event) !== hash) {
        checks.push({
          name: "canonical event hash",
          ok: false,
          position: i,
          detail: "hash mismatch",
        });
        eventHashesValid = false;
        break;
      }
    } catch (error) {
      checks.push({ name: "canonical event hash", ok: false, position: i, detail: String(error) });
      eventHashesValid = false;
      break;
    }
    const time = typeof event.occurred_at === "string" ? event.occurred_at : "";
    if (
      event.fund_id !== b.fund_id ||
      event.seq !== expectedSeq ||
      event.prev_hash !== prevHash ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) ||
      !Number.isFinite(Date.parse(time)) ||
      (previousTime !== "" && time < previousTime)
    ) {
      checks.push({
        name: "hash chain",
        ok: false,
        position: i,
        detail: "fund, sequence, or previous hash mismatch",
      });
      chainValid = false;
      break;
    }
    prevHash = hash;
    previousTime = time;
    expectedSeq++;
  }
  if (eventHashesValid)
    checks.push({
      name: "canonical event hashes",
      ok: true,
      detail: `${b.events.length} event(s)`,
    });
  if (chainValid)
    checks.push({ name: "hash chain", ok: true, detail: `${b.events.length} contiguous event(s)` });
  let proofsValid = true;
  for (let i = 0; i < b.events.length; i++) {
    const entry = required(b.events[i]);
    try {
      const root = b.roots.find(
        (candidate) =>
          Number(entry.event.seq) >= candidate.start_seq &&
          Number(entry.event.seq) <= candidate.end_seq,
      );
      const computed = wrappedFundRoot(entry, b.fund_id);
      if (
        !root ||
        entry.event.seq !== entry.eventProof.index + root.start_seq ||
        entry.eventProof.size !== root.end_seq - root.start_seq + 1 ||
        (entry.event.seq === root.end_seq && entry.event.hash !== entry.latest_event_hash) ||
        computed.eventRoot !== root.event_root ||
        computed.fundCount !== root.fund_count ||
        computed.globalRoot !== root.global_root
      )
        throw new Error(
          `proof does not match stated root/range (seq=${String(entry.event.seq)}, index=${entry.eventProof.index})`,
        );
    } catch (error) {
      checks.push({ name: "Merkle inclusion", ok: false, position: i, detail: String(error) });
      proofsValid = false;
      break;
    }
  }
  if (proofsValid)
    checks.push({
      name: "Merkle inclusion proofs",
      ok: true,
      detail: `${b.events.length} proof(s)`,
    });
  const rootsValid = b.roots.every(
    (root) =>
      root.start_seq <= root.end_seq &&
      root.end_seq >= b.chain.start_seq + 1 &&
      root.start_seq <= expectedSeq - 1 &&
      /^[0-9a-f]{64}$/.test(root.global_root),
  );
  let nextRootSeq = b.chain.start_seq + 1;
  const rangesComplete =
    b.roots.length > 0 &&
    b.roots.every((root) => {
      const contiguous = root.start_seq === nextRootSeq;
      nextRootSeq = root.end_seq + 1;
      return contiguous;
    }) &&
    nextRootSeq === expectedSeq;
  checks.push({
    name: "batch ranges and roots",
    ok: rootsValid && rangesComplete,
    ...(!(rootsValid && rangesComplete) ? { position: b.events.length } : {}),
    ...(!(rootsValid && rangesComplete)
      ? {
          detail: `invalid, overlapping, gapped, or incomplete batch ranges at sequence ${expectedSeq}`,
        }
      : {}),
  });
  const anchorValid =
    b.anchor.root === b.roots.at(-1)?.global_root &&
    b.anchor.chain_id > 0 &&
    /^0x[0-9a-fA-F]{40}$/.test(b.anchor.contract_address) &&
    /^0x[0-9a-fA-F]{64}$/.test(b.anchor.tx_hash);
  checks.push({
    name: "anchor reference",
    ok: anchorValid,
    ...(!anchorValid ? { detail: "anchor does not identify the final bundle root" } : {}),
  });
  return checks.map((check) =>
    check.ok
      ? check
      : {
          ...check,
          reasonCode:
            check.name === "canonical event hash"
              ? ReasonCode.EVENT_HASH_INVALID
              : check.name === "hash chain"
                ? ReasonCode.CHAIN_INVALID
                : check.name === "Merkle inclusion"
                  ? ReasonCode.PROOF_INVALID
                  : check.name === "batch ranges and roots"
                    ? ReasonCode.BATCH_INVALID
                    : ReasonCode.ANCHOR_INVALID,
        },
  );
}

export async function verifyAnchor(
  input: unknown,
  rpcUrl: string,
  expectedContract: string,
): Promise<Check[]> {
  try {
    const bundle = parseBundle(input);
    const rpc = async (method: string, params: unknown[]) => {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const value = (await response.json()) as { result?: string; error?: { message?: string } };
      if (!response.ok || value.error || !value.result)
        throw new Error(value.error?.message ?? `RPC HTTP ${response.status}`);
      return value.result;
    };
    const chainId = BigInt(await rpc("eth_chainId", []));
    if (chainId !== BigInt(bundle.anchor.chain_id))
      return [
        {
          name: "RPC chain id",
          ok: false,
          reasonCode: ReasonCode.ANCHOR_INVALID,
          detail: `expected ${bundle.anchor.chain_id}, got ${chainId}`,
        },
      ];
    if (expectedContract.toLowerCase() !== bundle.anchor.contract_address.toLowerCase())
      return [
        {
          name: "registry address",
          ok: false,
          reasonCode: ReasonCode.ANCHOR_INVALID,
          detail: "CLI address differs from bundle anchor",
        },
      ];
    // rootAt(uint64) selector from the RootRegistry ABI.
    const callData = `0xeaa38b41${BigInt(bundle.anchor.sequence).toString(16).padStart(64, "0")}`;
    const result = await rpc("eth_call", [{ to: expectedContract, data: callData }, "latest"]);
    return [
      {
        name: "on-chain root",
        ok: result.toLowerCase() === bundle.anchor.root.toLowerCase(),
        ...(!(result.toLowerCase() === bundle.anchor.root.toLowerCase())
          ? { reasonCode: ReasonCode.ANCHOR_INVALID }
          : {}),
        ...(result.toLowerCase() !== bundle.anchor.root.toLowerCase()
          ? { detail: `RPC returned ${result}` }
          : {}),
      },
    ];
  } catch (error) {
    return [
      {
        name: "on-chain root",
        ok: false,
        reasonCode: ReasonCode.ANCHOR_INVALID,
        detail: String(error),
      },
    ];
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("unexpected missing value");
  return value;
}

export type { Bundle };
