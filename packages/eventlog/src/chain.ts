import { fromHex, type Hash32, hash32, leafHash, type Salt32, sha256, toHex } from "@yen/shared";
import * as z from "zod/mini";
import { canonicalize } from "./canonical.js";
import {
  type Event,
  type EventHashHex,
  type EventInput,
  hashHexSchema,
  isUtcEventTime,
  parseEvent,
  parseUnsignedEvent,
  payloadSchemas,
  type UnsignedEvent,
} from "./model.js";

export const eventHashDomain = "yen/eventlog/event/v1\u0000";
const domainBytes = new TextEncoder().encode(eventHashDomain);
export const genesisHash: EventHashHex = hashHexSchema.parse("0".repeat(64));

export async function computeEventHash(envelope: UnsignedEvent): Promise<EventHashHex> {
  const parsed = parseUnsignedEvent(envelope);
  if (!parsed.ok) throw new TypeError(parsed.error);
  const bytes = new TextEncoder().encode(canonicalize(parsed.value));
  return hashHexSchema.parse(toHex(await sha256(domainBytes, bytes)));
}

export function eventHashToLeafInput(eventHash: EventHashHex): Hash32 {
  return hash32(fromHex(eventHash));
}

export async function eventLeafHash(salt: Salt32, eventHash: EventHashHex): Promise<Hash32> {
  return leafHash(salt, eventHashToLeafInput(eventHash));
}

export async function makeNextEvent(prev: Event | null, input: EventInput): Promise<Event> {
  if (prev !== null) {
    const previous = parseEvent(prev);
    if (!previous.ok) throw new TypeError("Previous event is invalid");
    const { hash: previousHash, ...previousEnvelope } = previous.value;
    if (previousHash !== (await computeEventHash(previousEnvelope))) {
      throw new TypeError("Previous event hash is invalid");
    }
    if (prev.fund_id !== input.fund_id) throw new TypeError("Events must belong to one fund");
    if (input.occurred_at < prev.occurred_at) throw new RangeError("Event time moved backwards");
    if (prev.seq >= Number.MAX_SAFE_INTEGER) throw new RangeError("Event sequence exhausted");
  }
  const candidate = parseEvent({
    ...input,
    seq: prev === null ? 1 : prev.seq + 1,
    prev_hash: prev === null ? genesisHash : prev.hash,
    hash: genesisHash,
  });
  if (!candidate.ok) throw new TypeError(candidate.error);
  const { hash: _placeholder, ...envelope } = candidate.value;
  const result = parseEvent({ ...envelope, hash: await computeEventHash(envelope) });
  if (!result.ok) throw new TypeError(result.error);
  return result.value;
}

export type ChainBreakReason =
  | "gap"
  | "wrong prev_hash"
  | "wrong hash"
  | "unknown type/version"
  | "bad envelope"
  | "non-monotonic time"
  | "non-UTC time"
  | "truncation"
  | "unexpected events";

export const chainHeadSchema = z
  .strictObject({
    count: z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER)),
    latestHash: hashHexSchema,
  })
  .brand<"ChainHead">();
export type ChainHead = z.infer<typeof chainHeadSchema>;

type ChainBreak = {
  readonly ok: false;
  readonly index: number;
  readonly seq: number | null;
  readonly reason: ChainBreakReason;
};

export type ChainVerification =
  | { readonly ok: true; readonly count: number; readonly latestHash: EventHashHex }
  | ChainBreak;
export type ChainStructureCheck =
  | { readonly ok: true; readonly kind: "structure-only"; readonly head: ChainHead }
  | ChainBreak;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function checkChainStructureStream(
  events: AsyncIterable<unknown>,
): Promise<ChainStructureCheck> {
  let count = 0;
  let previous: Event | null = null;
  for await (const raw of events) {
    const index = count;
    const rawSeq =
      isRecord(raw) && typeof raw.seq === "number" && Number.isSafeInteger(raw.seq)
        ? raw.seq
        : null;
    const broken = (reason: ChainBreakReason): ChainBreak => ({
      ok: false,
      index,
      seq: rawSeq,
      reason,
    });
    if (!isRecord(raw)) return broken("bad envelope");
    if (
      typeof raw.type !== "string" ||
      !Object.hasOwn(payloadSchemas, raw.type) ||
      raw.version !== 1
    ) {
      return broken("unknown type/version");
    }
    if (!isUtcEventTime(raw.occurred_at)) return broken("non-UTC time");
    const parsed = parseEvent(raw);
    if (!parsed.ok) return broken("bad envelope");
    const event = parsed.value;
    if (previous !== null && event.fund_id !== previous.fund_id) return broken("bad envelope");
    if (event.seq !== index + 1) return broken("gap");
    if (event.prev_hash !== (previous === null ? genesisHash : previous.hash))
      return broken("wrong prev_hash");
    if (previous !== null && event.occurred_at < previous.occurred_at)
      return broken("non-monotonic time");
    const { hash, ...envelope } = event;
    if (hash !== (await computeEventHash(envelope))) return broken("wrong hash");
    previous = event;
    count++;
  }
  const latestHash = previous === null ? genesisHash : previous.hash;
  return { ok: true, kind: "structure-only", head: chainHeadSchema.parse({ count, latestHash }) };
}

export async function checkChainStructure(events: Iterable<unknown>): Promise<ChainStructureCheck> {
  async function* stream(): AsyncIterable<unknown> {
    yield* events;
  }
  return checkChainStructureStream(stream());
}

export async function verifyChainStream(
  events: AsyncIterable<unknown>,
  expected: ChainHead,
): Promise<ChainVerification> {
  const result = await checkChainStructureStream(events);
  if (!result.ok) return result;
  const { count, latestHash } = result.head;
  if (count < expected.count || (count === 0 && latestHash !== expected.latestHash)) {
    return { ok: false, index: count, seq: count + 1, reason: "truncation" };
  }
  if (count > expected.count) {
    return { ok: false, index: count, seq: count + 1, reason: "unexpected events" };
  }
  if (latestHash !== expected.latestHash) {
    return { ok: false, index: count, seq: count, reason: "wrong hash" };
  }
  return { ok: true, count, latestHash };
}

export async function verifyChain(
  events: Iterable<unknown>,
  expected: ChainHead,
): Promise<ChainVerification> {
  async function* stream(): AsyncIterable<unknown> {
    yield* events;
  }
  return verifyChainStream(stream(), expected);
}
