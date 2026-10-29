import { type FundId, parseFundId } from "../ids.js";
import {
  equalBytes,
  fromHex,
  type Hash32,
  hash32,
  type Salt32,
  salt32,
  sha256,
  toHex,
} from "./hash.js";
import { fingerprint, fundLeaf, globalRoot } from "./interval.js";
import { type InclusionProof, leafHash, rootFromInclusion } from "./tree.js";

export type AuditProof = {
  readonly index: number;
  readonly size: number;
  readonly path: readonly string[];
};

export type AuditEvent = {
  readonly fund_id: string;
  readonly seq: number;
  readonly type: string;
  readonly version: number;
  readonly actor: string;
  readonly occurred_at: string;
  readonly payload: Record<string, unknown>;
  readonly prev_hash: string;
  readonly hash: string;
  readonly [key: string]: unknown;
};

export type AuditEventEntry = {
  readonly event: AuditEvent;
  readonly salt: string;
  readonly latest_event_hash: string;
  readonly eventProof: AuditProof;
  readonly fundProof: AuditProof;
};

export type AuditRootRange = {
  readonly start_seq: number;
  readonly end_seq: number;
  readonly event_root: string;
  readonly fund_count: number;
  readonly global_root: string;
};

export type AuditAnchor = {
  readonly chain_id: number;
  readonly contract_address: string;
  readonly tx_hash: string;
  readonly root: string;
  readonly sequence: number;
};

export type AuditBundle = {
  readonly format: "yen/audit-bundle/v1";
  readonly fund_id: string;
  readonly chain: {
    readonly start_seq: number;
    readonly start_hash: string;
  };
  readonly events: readonly AuditEventEntry[];
  readonly roots: readonly AuditRootRange[];
  readonly anchor: AuditAnchor;
};

export const AuditReasonCode = {
  FORMAT_INVALID: "FORMAT_INVALID",
  EVENT_HASH_INVALID: "EVENT_HASH_INVALID",
  CHAIN_INVALID: "CHAIN_INVALID",
  PROOF_INVALID: "PROOF_INVALID",
  BATCH_INVALID: "BATCH_INVALID",
  ANCHOR_INVALID: "ANCHOR_INVALID",
} as const;

export type AuditReasonCode = (typeof AuditReasonCode)[keyof typeof AuditReasonCode];

export type AuditCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly reasonCode?: AuditReasonCode | undefined;
  readonly position?: number | undefined;
  readonly detail?: string | undefined;
};

const REQUIRED_EVENT_KEYS = [
  "fund_id",
  "seq",
  "type",
  "version",
  "actor",
  "occurred_at",
  "payload",
  "prev_hash",
  "hash",
] as const;

const EVENT_DOMAIN = new TextEncoder().encode("yen/eventlog/event/v1\0");

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

export function canonicalizeJson(value: unknown): string {
  if (typeof value === "string") {
    if (!validUnicode(value)) throw new TypeError("JCS rejects lone surrogates");
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("JCS requires finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    if (!validUnicode(key)) throw new TypeError("JCS rejects lone surrogates in keys");
  }
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`)
    .join(",")}}`;
}

export async function computeCanonicalEventHash(event: Record<string, unknown>): Promise<string> {
  const unsigned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key !== "hash") {
      unsigned[key] = value;
    }
  }
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(unsigned));
  return toHex(await sha256(EVENT_DOMAIN, canonicalBytes));
}

function parseBundle(input: unknown): AuditBundle {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("bundle must be an object");
  }
  const b = input as Partial<AuditBundle>;
  if (
    b.format !== "yen/audit-bundle/v1" ||
    !Array.isArray(b.events) ||
    !Array.isArray(b.roots) ||
    !b.anchor ||
    !b.chain
  ) {
    throw new Error("unsupported or malformed bundle");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(b.fund_id ?? "")) {
    throw new Error("invalid fund_id");
  }
  if (
    b.events.length === 0 ||
    !Number.isSafeInteger(b.chain.start_seq) ||
    b.chain.start_seq < 0 ||
    !/^[0-9a-f]{64}$/.test(b.chain.start_hash ?? "") ||
    !Number.isSafeInteger(b.anchor.chain_id) ||
    b.anchor.chain_id < 1 ||
    !Number.isSafeInteger(b.anchor.sequence) ||
    b.anchor.sequence < 1 ||
    !/^[0-9a-f]{64}$/.test(b.anchor.root ?? "")
  ) {
    throw new Error("invalid chain checkpoint or anchor metadata");
  }
  for (const root of b.roots) {
    if (
      !Number.isSafeInteger(root.start_seq) ||
      !Number.isSafeInteger(root.end_seq) ||
      !Number.isSafeInteger(root.fund_count) ||
      root.fund_count < 1 ||
      !/^[0-9a-f]{64}$/.test(root.event_root ?? "") ||
      !/^[0-9a-f]{64}$/.test(root.global_root ?? "")
    ) {
      throw new Error("invalid root metadata");
    }
  }
  return b as AuditBundle;
}

function toInclusionProof(proof: AuditProof): InclusionProof {
  return {
    index: proof.index,
    size: proof.size,
    path: proof.path.map((hex) => hash32(fromHex(hex))),
  };
}

export async function verifyAuditBundle(input: unknown): Promise<AuditCheck[]> {
  let b: AuditBundle;
  try {
    b = parseBundle(input);
  } catch (error) {
    return [
      {
        name: "bundle format",
        ok: false,
        reasonCode: AuditReasonCode.FORMAT_INVALID,
        detail: String(error),
      },
    ];
  }

  const checks: AuditCheck[] = [];
  let prevHash = b.chain.start_hash;
  let expectedSeq = b.chain.start_seq + 1;
  let previousTime = "";
  let eventHashesValid = true;
  let chainValid = true;

  for (let i = 0; i < b.events.length; i++) {
    const entry = b.events[i];
    if (!entry) throw new Error("unexpected missing entry");
    const event = entry.event;
    const hash = typeof event.hash === "string" ? event.hash : "";

    const keys = Object.keys(event);
    if (
      keys.length !== REQUIRED_EVENT_KEYS.length ||
      REQUIRED_EVENT_KEYS.some((key) => !Object.hasOwn(event, key))
    ) {
      checks.push({
        name: "canonical event hash",
        ok: false,
        reasonCode: AuditReasonCode.EVENT_HASH_INVALID,
        position: i,
        detail: "event envelope fields differ from v1",
      });
      eventHashesValid = false;
      break;
    }

    try {
      const computedHash = await computeCanonicalEventHash(event);
      if (computedHash !== hash) {
        checks.push({
          name: "canonical event hash",
          ok: false,
          reasonCode: AuditReasonCode.EVENT_HASH_INVALID,
          position: i,
          detail: "hash mismatch",
        });
        eventHashesValid = false;
        break;
      }
    } catch (error) {
      checks.push({
        name: "canonical event hash",
        ok: false,
        reasonCode: AuditReasonCode.EVENT_HASH_INVALID,
        position: i,
        detail: String(error),
      });
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
        reasonCode: AuditReasonCode.CHAIN_INVALID,
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

  if (eventHashesValid) {
    checks.push({
      name: "canonical event hashes",
      ok: true,
      detail: `${b.events.length} event(s)`,
    });
  }

  if (chainValid) {
    checks.push({
      name: "hash chain",
      ok: true,
      detail: `${b.events.length} contiguous event(s)`,
    });
  }

  let proofsValid = true;
  for (let i = 0; i < b.events.length; i++) {
    const entry = b.events[i];
    if (!entry) throw new Error("unexpected missing entry");
    try {
      const root = b.roots.find(
        (candidate) =>
          Number(entry.event.seq) >= candidate.start_seq &&
          Number(entry.event.seq) <= candidate.end_seq,
      );
      if (!root) {
        throw new Error(`no matching batch range for event sequence ${entry.event.seq}`);
      }

      const leafH = await leafHash(
        salt32(fromHex(entry.salt)),
        hash32(fromHex(String(entry.event.hash))),
      );
      const eventProofObj = toInclusionProof(entry.eventProof);
      const computedEventRoot = await rootFromInclusion(eventProofObj, leafH);
      if (!computedEventRoot) throw new Error("invalid event inclusion path");

      const fundIdParsed = parseFundId(b.fund_id);
      if (!fundIdParsed.ok) throw new Error("invalid fund id");

      const fundFingerprint = await fingerprint(
        fundIdParsed.value,
        hash32(fromHex(entry.latest_event_hash)),
      );
      const fundLeafH = await fundLeaf(
        entry.eventProof.size,
        computedEventRoot,
        fundFingerprint,
      );

      const fundProofObj = toInclusionProof(entry.fundProof);
      const globalTreeRoot = await rootFromInclusion(fundProofObj, fundLeafH);
      if (!globalTreeRoot) throw new Error("invalid fund inclusion path");

      const computedGlobalRoot = await globalRoot(entry.fundProof.size, globalTreeRoot);
      const eventRootHex = toHex(computedEventRoot);
      const globalRootHex = toHex(computedGlobalRoot);

      if (
        entry.event.seq !== entry.eventProof.index + root.start_seq ||
        entry.eventProof.size !== root.end_seq - root.start_seq + 1 ||
        (entry.event.seq === root.end_seq && entry.event.hash !== entry.latest_event_hash) ||
        eventRootHex !== root.event_root ||
        entry.fundProof.size !== root.fund_count ||
        globalRootHex !== root.global_root
      ) {
        throw new Error(
          `proof does not match stated root/range (seq=${String(entry.event.seq)}, index=${entry.eventProof.index})`,
        );
      }
    } catch (error) {
      checks.push({
        name: "Merkle inclusion",
        ok: false,
        reasonCode: AuditReasonCode.PROOF_INVALID,
        position: i,
        detail: String(error),
      });
      proofsValid = false;
      break;
    }
  }

  if (proofsValid) {
    checks.push({
      name: "Merkle inclusion proofs",
      ok: true,
      detail: `${b.events.length} proof(s)`,
    });
  }

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
    ...(rootsValid && rangesComplete
      ? {}
      : {
          reasonCode: AuditReasonCode.BATCH_INVALID,
          position: b.events.length,
          detail: `invalid, overlapping, gapped, or incomplete batch ranges at sequence ${expectedSeq}`,
        }),
  });

  const anchorValid =
    b.anchor.root === b.roots.at(-1)?.global_root &&
    b.anchor.chain_id > 0 &&
    /^0x[0-9a-fA-F]{40}$/.test(b.anchor.contract_address) &&
    /^0x[0-9a-fA-F]{64}$/.test(b.anchor.tx_hash);

  checks.push({
    name: "anchor reference",
    ok: anchorValid,
    ...(anchorValid
      ? {}
      : {
          reasonCode: AuditReasonCode.ANCHOR_INVALID,
          detail: "anchor does not identify the final bundle root",
        }),
  });

  return checks;
}

export function exportAuditBundleCsv(bundle: AuditBundle): string {
  const headers = [
    "fund_id",
    "sequence",
    "event_type",
    "occurred_at",
    "event_hash",
    "prev_hash",
    "salt",
    "latest_event_hash",
    "event_root",
    "global_root",
    "anchor_sequence",
    "anchor_tx_hash",
    "anchor_contract",
  ];

  const rows = bundle.events.map((entry) => {
    const root = bundle.roots.find(
      (r) => entry.event.seq >= r.start_seq && entry.event.seq <= r.end_seq,
    );
    return [
      bundle.fund_id,
      entry.event.seq,
      `"${entry.event.type}"`,
      `"${entry.event.occurred_at}"`,
      entry.event.hash,
      entry.event.prev_hash,
      entry.salt,
      entry.latest_event_hash,
      root?.event_root ?? "",
      root?.global_root ?? "",
      bundle.anchor.sequence,
      bundle.anchor.tx_hash,
      bundle.anchor.contract_address,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}
