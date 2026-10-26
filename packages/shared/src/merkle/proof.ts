import { fromHex, type Hash32, hash32, type Salt32, salt32, toHex } from "./hash.js";
import type { InclusionProof } from "./tree.js";

declare const fundIdBrand: unique symbol;
const eventProofBrand = Symbol("EventProof");

export type FundId = string & { readonly [fundIdBrand]: "FundId" };
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

type EventProofFields = {
  readonly format: "yen/event-proof/v1";
  readonly salt: Salt32;
  readonly eventHash: Hash32;
  readonly eventProof: InclusionProof;
  readonly fundId: FundId;
  readonly latestEventHash: Hash32;
  readonly fundProof: InclusionProof;
};

export type EventProof = EventProofFields & { readonly [eventProofBrand]: true };

export function createEventProof(fields: EventProofFields): EventProof {
  return { ...fields, [eventProofBrand]: true };
}

function isFundId(input: unknown): input is FundId {
  return typeof input === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input);
}

export function parseFundId(input: unknown): Result<FundId> {
  return isFundId(input)
    ? { ok: true, value: input }
    : { ok: false, error: "Expected a canonical lowercase UUID" };
}

function hex32(input: unknown): Result<Uint8Array> {
  return typeof input === "string" && /^[0-9a-f]{64}$/.test(input)
    ? { ok: true, value: fromHex(input) }
    : { ok: false, error: "Expected 32 bytes encoded as lowercase hex" };
}

export function parseHash32(input: unknown): Result<Hash32> {
  const parsed = hex32(input);
  return parsed.ok ? { ok: true, value: hash32(parsed.value) } : parsed;
}

export function parseSalt32(input: unknown): Result<Salt32> {
  const parsed = hex32(input);
  return parsed.ok ? { ok: true, value: salt32(parsed.value) } : parsed;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key))
  );
}

function pathLength(index: number, size: number): number {
  let length = 0;
  while (size > 1) {
    let split = 1;
    while (split * 2 < size) split *= 2;
    if (index < split) size = split;
    else {
      index -= split;
      size -= split;
    }
    length++;
  }
  return length;
}

export function parseInclusionProof(input: unknown): Result<InclusionProof> {
  if (!isRecord(input) || !hasKeys(input, ["index", "size", "path"])) {
    return { ok: false, error: "Expected index, size and path" };
  }
  const { index, size, path } = input;
  if (
    typeof index !== "number" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(size) ||
    index < 0 ||
    index >= size ||
    !Array.isArray(path) ||
    path.length !== pathLength(index, size)
  ) {
    return { ok: false, error: "Invalid inclusion proof position or path length" };
  }
  const hashes: Hash32[] = [];
  for (const element of path) {
    const parsed = parseHash32(element);
    if (!parsed.ok) return parsed;
    hashes.push(parsed.value);
  }
  return { ok: true, value: { index, size, path: hashes } };
}

export function parseEventProof(input: unknown): Result<EventProof> {
  if (
    !isRecord(input) ||
    !hasKeys(input, [
      "format",
      "salt",
      "eventHash",
      "eventProof",
      "fundId",
      "latestEventHash",
      "fundProof",
    ]) ||
    input.format !== "yen/event-proof/v1"
  ) {
    return { ok: false, error: "Expected a yen/event-proof/v1 bundle" };
  }
  const salt = parseSalt32(input.salt);
  if (!salt.ok) return salt;
  const eventHash = parseHash32(input.eventHash);
  if (!eventHash.ok) return eventHash;
  const eventProof = parseInclusionProof(input.eventProof);
  if (!eventProof.ok) return eventProof;
  const fundId = parseFundId(input.fundId);
  if (!fundId.ok) return fundId;
  const latestEventHash = parseHash32(input.latestEventHash);
  if (!latestEventHash.ok) return latestEventHash;
  const fundProof = parseInclusionProof(input.fundProof);
  if (!fundProof.ok) return fundProof;
  return {
    ok: true,
    value: createEventProof({
      format: input.format,
      salt: salt.value,
      eventHash: eventHash.value,
      eventProof: eventProof.value,
      fundId: fundId.value,
      latestEventHash: latestEventHash.value,
      fundProof: fundProof.value,
    }),
  };
}

export function parseEventProofJson(json: string): Result<EventProof> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid proof JSON" };
  }
  return parseEventProof(input);
}

export function serializeEventProof(bundle: EventProof): string {
  const encode = (proof: InclusionProof) => ({
    index: proof.index,
    size: proof.size,
    path: proof.path.map(toHex),
  });
  return JSON.stringify({
    format: bundle.format,
    salt: toHex(bundle.salt),
    eventHash: toHex(bundle.eventHash),
    eventProof: encode(bundle.eventProof),
    fundId: bundle.fundId,
    latestEventHash: toHex(bundle.latestEventHash),
    fundProof: encode(bundle.fundProof),
  });
}
