import * as z from "zod/mini";
import { fromHex, type Hash32, hash32, type Salt32, salt32, toHex } from "./hash.js";
import type { InclusionProof } from "./tree.js";

declare const fundIdBrand: unique symbol;
const eventProofBrand = Symbol("EventProof");
const fundIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hex32Pattern = /^[0-9a-f]{64}$/;

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
  return typeof input === "string" && fundIdPattern.test(input);
}

export function parseFundId(input: unknown): Result<FundId> {
  return isFundId(input)
    ? { ok: true, value: input }
    : { ok: false, error: "Expected a canonical lowercase UUID" };
}

function hex32(input: unknown): Result<Uint8Array> {
  return typeof input === "string" && hex32Pattern.test(input)
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

const hex32Schema = z.string().check(z.regex(hex32Pattern));
const fundIdSchema = z.string().check(z.regex(fundIdPattern));
const nonnegativeSafeIntegerSchema = z.int().check(z.nonnegative());
const inclusionProofSchema = z
  .strictObject({
    index: nonnegativeSafeIntegerSchema,
    size: nonnegativeSafeIntegerSchema,
    path: z.array(hex32Schema),
  })
  .check(
    z.refine(({ index, size, path }) => index < size && path.length === pathLength(index, size)),
  );
const eventProofSchema = z.strictObject({
  format: z.literal("yen/event-proof/v1"),
  salt: hex32Schema,
  eventHash: hex32Schema,
  eventProof: inclusionProofSchema,
  fundId: fundIdSchema,
  latestEventHash: hex32Schema,
  fundProof: inclusionProofSchema,
});

function checkedInclusionProof(proof: z.infer<typeof inclusionProofSchema>): InclusionProof {
  return {
    index: proof.index,
    size: proof.size,
    path: proof.path.map((hex) => hash32(fromHex(hex))),
  };
}

export function parseInclusionProof(input: unknown): Result<InclusionProof> {
  const parsed = inclusionProofSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: checkedInclusionProof(parsed.data) }
    : { ok: false, error: "Invalid inclusion proof" };
}

export function parseEventProof(input: unknown): Result<EventProof> {
  const parsed = eventProofSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Expected a yen/event-proof/v1 bundle" };
  }
  const bundle = parsed.data;
  return {
    ok: true,
    value: createEventProof({
      format: bundle.format,
      salt: salt32(fromHex(bundle.salt)),
      eventHash: hash32(fromHex(bundle.eventHash)),
      eventProof: checkedInclusionProof(bundle.eventProof),
      fundId: bundle.fundId as FundId,
      latestEventHash: hash32(fromHex(bundle.latestEventHash)),
      fundProof: checkedInclusionProof(bundle.fundProof),
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
