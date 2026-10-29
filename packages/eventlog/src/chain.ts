import {
  type FundId,
  fromHex,
  fundIdSchema,
  type Hash32,
  hash32,
  leafHash,
  type Salt32,
  sha256,
  toHex,
} from "@yen/shared";
import * as z from "zod/mini";
import { canonicalize } from "./canonical.js";
import {
  type Event,
  type EventHashHex,
  type EventInput,
  hashHexSchema,
  isKnownEventVersion,
  isUtcEventTime,
  parseEvent,
  parseUnsignedEvent,
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
  | "unexpected events"
  | "fund mismatch";

const chainHeadSchema = z
  .strictObject({
    fundId: fundIdSchema,
    count: z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER)),
    latestHash: hashHexSchema,
  })
  .check(z.refine(({ count, latestHash }) => count !== 0 || latestHash === genesisHash))
  .brand<"ChainHead">();
export type ChainHead = z.infer<typeof chainHeadSchema>;
export type ObservedChainHead = Readonly<{
  fundId: string | null;
  count: number;
  latestHash: EventHashHex;
}>;

export function chainHead(
  input: Readonly<{ fundId: FundId; count: number; latestHash: EventHashHex }>,
): ChainHead {
  return chainHeadSchema.parse(input);
}

type ChainBreakDetails = {
  /** Zero-based position in the supplied sequence, while seq is one-based. */
  readonly index: number;
  /** One-based event sequence, or null if the event has no valid sequence. */
  readonly seq: number | null;
  readonly reason: ChainBreakReason;
};
type ChainBreak = ChainBreakDetails & { readonly ok: false };
type ChainStructureBreak = ChainBreakDetails & { readonly status: "broken" };

export type ChainVerification =
  | {
      readonly ok: true;
      readonly count: number;
      readonly latestHash: EventHashHex;
      readonly verifiedAgainst: ChainHead;
    }
  | ChainBreak;
export type ChainStructureCheck =
  | { readonly status: "structure-consistent"; readonly observedHead: ObservedChainHead }
  | ChainStructureBreak;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function closeAsyncIterator(
  iterator: AsyncIterator<unknown>,
  sourceFailed: boolean,
): Promise<void> {
  try {
    await iterator.return?.();
  } catch (error) {
    if (!sourceFailed) throw error;
  }
}

function closeSyncIterator(iterator: Iterator<unknown>, sourceFailed: boolean): void {
  try {
    iterator.return?.();
  } catch (error) {
    if (!sourceFailed) throw error;
  }
}

async function scanChainStructureStream(
  events: AsyncIterable<unknown>,
  expected?: ChainHead,
): Promise<ChainStructureCheck> {
  let count = 0;
  let previous: Event | null = null;
  const iterator = events[Symbol.asyncIterator]();
  let exhausted = false;
  let sourceFailed = false;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      const raw = next.value;
      const index = count;
      const seqDescriptor = isRecord(raw) ? Object.getOwnPropertyDescriptor(raw, "seq") : undefined;
      const rawSeq =
        seqDescriptor !== undefined &&
        "value" in seqDescriptor &&
        typeof seqDescriptor.value === "number" &&
        Number.isSafeInteger(seqDescriptor.value)
          ? seqDescriptor.value
          : null;
      const broken = (reason: ChainBreakReason): ChainStructureBreak => ({
        status: "broken",
        index,
        seq: rawSeq,
        reason,
      });
      if (!isRecord(raw)) return broken("bad envelope");
      try {
        canonicalize(raw);
      } catch {
        return broken("bad envelope");
      }
      if (
        typeof raw.type !== "string" ||
        typeof raw.version !== "number" ||
        !isKnownEventVersion(raw.type, raw.version)
      ) {
        return broken("unknown type/version");
      }
      if (!isUtcEventTime(raw.occurred_at)) return broken("non-UTC time");
      const parsed = parseEvent(raw);
      if (!parsed.ok) return broken("bad envelope");
      const event = parsed.value;
      if (expected !== undefined && event.fund_id !== expected.fundId)
        return broken("fund mismatch");
      if (previous !== null && event.fund_id !== previous.fund_id) return broken("fund mismatch");
      if (expected !== undefined && count >= expected.count) return broken("unexpected events");
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
  } catch (error) {
    sourceFailed = true;
    throw error;
  } finally {
    if (!exhausted) await closeAsyncIterator(iterator, sourceFailed);
  }
  const latestHash = previous === null ? genesisHash : previous.hash;
  return {
    status: "structure-consistent",
    observedHead: { fundId: previous?.fund_id ?? null, count, latestHash },
  };
}

export async function checkChainStructureStream(
  events: AsyncIterable<unknown>,
): Promise<ChainStructureCheck> {
  return scanChainStructureStream(events);
}

async function* asAsync(events: Iterable<unknown>): AsyncIterable<unknown> {
  const iterator = events[Symbol.iterator]();
  let exhausted = false;
  let sourceFailed = false;
  try {
    while (true) {
      const next = iterator.next();
      if (next.done) {
        exhausted = true;
        return;
      }
      yield next.value;
    }
  } catch (error) {
    sourceFailed = true;
    throw error;
  } finally {
    if (!exhausted) closeSyncIterator(iterator, sourceFailed);
  }
}

export async function checkChainStructure(events: Iterable<unknown>): Promise<ChainStructureCheck> {
  return checkChainStructureStream(asAsync(events));
}

export async function verifyChainStream(
  events: AsyncIterable<unknown>,
  expected: ChainHead,
): Promise<ChainVerification> {
  const authenticated = chainHead(expected);
  const result = await scanChainStructureStream(events, authenticated);
  if (result.status === "broken") {
    return { ok: false, index: result.index, seq: result.seq, reason: result.reason };
  }
  const { count, latestHash } = result.observedHead;
  if (count < authenticated.count) {
    return { ok: false, index: count, seq: count + 1, reason: "truncation" };
  }
  if (latestHash !== authenticated.latestHash) {
    return { ok: false, index: count, seq: count, reason: "wrong hash" };
  }
  return { ok: true, count, latestHash, verifiedAgainst: authenticated };
}

export async function verifyChain(
  events: Iterable<unknown>,
  expected: ChainHead,
): Promise<ChainVerification> {
  return verifyChainStream(asAsync(events), expected);
}
