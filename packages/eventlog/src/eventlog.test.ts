import { readFileSync } from "node:fs";
import { leafHash, parseFundId, type Result, salt32, toHex } from "@yen/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import {
  canonicalize,
  chainHead,
  checkChainStructure,
  checkChainStructureStream,
  computeEventHash,
  type Event,
  eventHashDomain,
  eventHashToLeafInput,
  eventLeafHash,
  eventSubjectId,
  genesisHash,
  makeNextEvent,
  parseEvent,
  payloadSchemas,
  verifyChain,
  verifyChainStream,
} from "./index.js";

const vectorSchema = z.array(
  z.union([
    z.strictObject({ name: z.string(), input: z.unknown(), canonical: z.string() }),
    z.strictObject({ name: z.string(), input: z.unknown(), error: z.literal("lone surrogate") }),
  ]),
);
const goldenSchema = z.strictObject({
  domain_utf8: z.string(),
  genesis_hash: z.string(),
  latest_hash: z.string(),
  events: z.array(z.strictObject({ event: z.unknown(), canonical: z.string() })),
});
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../test-vectors/${name}`, import.meta.url), "utf8"));
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const vectors = vectorSchema.parse(fixture("canonical-vectors.json"));
const golden = goldenSchema.parse(fixture("golden-events.json"));
const events = golden.events.map((row) => unwrap(parseEvent(row.event)));
const firstGoldenEvent = events[0];
if (firstGoldenEvent === undefined) throw new Error("Missing golden event");
const fundId = firstGoldenEvent.fund_id;
const head = chainHead({
  fundId,
  count: events.length,
  latestHash: events.at(-1)?.hash ?? genesisHash,
});

describe("RFC 8785 canonical JSON", () => {
  it("matches the published RFC number example", () => {
    expect(canonicalize([Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27]",
    );
  });

  it.each(vectors)("matches independent Python vector $name", (vector) => {
    if ("canonical" in vector) expect(canonicalize(vector.input)).toBe(vector.canonical);
    else expect(() => canonicalize(vector.input)).toThrow(/lone surrogate/i);
  });

  it("loads Python vectors for a surrogate pair and a rejected lone surrogate", () => {
    const pair = vectors.find((vector) => vector.name === "surrogate_pair");
    const lone = vectors.find((vector) => vector.name === "lone_surrogate");
    expect(pair).toMatchObject({ canonical: '"😀"' });
    expect(lone).toMatchObject({ error: "lone surrogate" });
    if (pair === undefined || lone === undefined) throw new Error("Missing Unicode vectors");
    expect(canonicalize(pair.input)).toBe('"😀"');
    expect(() => canonicalize(lone.input)).toThrow(/lone surrogate/i);
  });

  it("loads independent U+2028, U+2029, and DEL vectors", () => {
    for (const [name, canonical] of [
      ["line_separator", '"\u2028"'],
      ["paragraph_separator", '"\u2029"'],
      ["delete_control", '"\u007f"'],
    ]) {
      const vector = vectors.find((candidate) => candidate.name === name);
      expect(vector).toMatchObject({ canonical });
      if (vector === undefined) throw new Error(`Missing ${name} vector`);
      expect(canonicalize(vector.input)).toBe(canonical);
    }
  });

  it("rejects non-JSON values, invalid unicode, and cycles", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      undefined,
      Number.NaN,
      Infinity,
      -Infinity,
      () => 1,
      Symbol("x"),
      1n,
      "\ud800",
      [undefined],
      { x: undefined },
      cyclic,
    ]) {
      expect(() => canonicalize(value)).toThrow();
    }
  });

  it("rejects arrays with custom prototypes, annotations, symbols, or toJSON", () => {
    class ExtendedArray extends Array<number> {}
    const annotated = Object.assign([1], { note: "hidden from JSON" });
    const symbolKeyed = [1];
    Object.defineProperty(symbolKeyed, Symbol("tag"), { value: true });
    const withToJson = Object.assign([1], { toJSON: () => [2] });
    const wrongPrototype = [1];
    Object.setPrototypeOf(wrongPrototype, null);
    for (const value of [
      new ExtendedArray(1),
      annotated,
      symbolKeyed,
      withToJson,
      wrongPrototype,
    ]) {
      expect(() => canonicalize(value)).toThrow(/array|symbol|toJSON/i);
    }
    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => canonicalize(sparse)).toThrow(/sparse array/i);
  });

  it("rejects hidden properties, symbol keys, and accessors", () => {
    const hiddenArray = [1];
    Object.defineProperty(hiddenArray, "hidden", { value: 2 });
    const hiddenObject = { visible: 1 };
    Object.defineProperty(hiddenObject, "hidden", { value: 2 });
    const symbolObject = { visible: 1 };
    Object.defineProperty(symbolObject, Symbol("hidden"), { value: 2 });
    const accessorArray = [1];
    Object.defineProperty(accessorArray, "0", { get: () => 1 });
    const accessorObject = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    for (const value of [hiddenArray, hiddenObject, symbolObject, accessorArray, accessorObject]) {
      expect(() => canonicalize(value)).toThrow();
    }
  });

  it("is stable across JSON parse round trips", () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.integer({ min: -1000000, max: 1000000 }),
          b: fc.array(fc.constantFrom("plain", "é", "😀", "\n", "\u2028"), { maxLength: 8 }),
        }),
        (value) => {
          expect(canonicalize(JSON.parse(JSON.stringify(value)))).toBe(canonicalize(value));
        },
      ),
    );
  });
});

describe("frozen event hashes", () => {
  it("hashes only an exact unsigned event envelope", async () => {
    const event = events[0];
    if (event === undefined) throw new Error("Missing golden event");
    const { hash, ...unsigned } = event;
    expect(await computeEventHash(unsigned)).toBe(hash);
    await expect(computeEventHash(event)).rejects.toThrow(/unsigned event envelope/);
    const extra = { ...unsigned, unexpected: true };
    await expect(computeEventHash(extra)).rejects.toThrow(/unsigned event envelope/);
    const hiddenExtra = { ...unsigned };
    Object.defineProperty(hiddenExtra, "hidden", { value: true });
    await expect(computeEventHash(hiddenExtra)).rejects.toThrow(/unsigned event envelope/);
    const symbolExtra = { ...unsigned };
    Object.defineProperty(symbolExtra, Symbol("hidden"), { value: true });
    await expect(computeEventHash(symbolExtra)).rejects.toThrow(/unsigned event envelope/);
    const { seq: _seq, ...missing } = unsigned;
    await expect(Reflect.apply(computeEventHash, undefined, [missing])).rejects.toThrow(
      /unsigned event envelope/,
    );
  });
  it("pins every v1 event, canonical string, and hash", async () => {
    expect(events.length).toBe(24);
    expect(eventHashDomain).toBe(golden.domain_utf8);
    expect(genesisHash).toBe(golden.genesis_hash);
    expect(
      head.latestHash,
      "these hashes are frozen: a change here is a breaking change to every recorded event",
    ).toBe(golden.latest_hash);
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set(Object.keys(payloadSchemas)),
    );
    for (const [index, row] of golden.events.entries()) {
      const event = events[index];
      if (event === undefined) throw new Error("Missing golden event");
      const { hash, ...envelope } = event;
      expect(canonicalize(envelope), `canonical bytes changed at seq ${event.seq}`).toBe(
        row.canonical,
      );
      expect(
        await computeEventHash(envelope),
        `these hashes are frozen: a change here is a breaking change to every recorded event (seq ${event.seq})`,
      ).toBe(hash);
      expect(eventSubjectId(event)).toMatch(/^(?:psn_)?[0-9a-f-]{36}$/);
    }
    expect(await verifyChain(events, head)).toEqual({
      ok: true,
      count: events.length,
      latestHash: head.latestHash,
      verifiedAgainst: head,
    });
  });

  it("reproduces the independent chain with makeNextEvent", async () => {
    let previous: Event | null = null;
    for (const event of events) {
      const { seq: _seq, prev_hash: _prevHash, hash: _hash, ...input } = event;
      const next = await makeNextEvent(previous, input);
      expect(next).toEqual(event);
      previous = next;
    }
  });

  it("passes event hashes into the shared Merkle leaf function", async () => {
    const event = events[0];
    if (event === undefined) throw new Error("Missing golden event");
    const salt = salt32(new Uint8Array(32).fill(7));
    expect(toHex(await eventLeafHash(salt, event.hash))).toBe(
      toHex(await leafHash(salt, eventHashToLeafInput(event.hash))),
    );
    expect(new TextEncoder().encode(eventHashDomain)[0]).not.toBeLessThan(5);
  });

  it("hashes reordered input keys identically", async () => {
    const event = events[0];
    if (event === undefined) throw new Error("Missing golden event");
    const parsed = unwrap(parseEvent(Object.fromEntries(Object.entries(event).reverse())));
    const { hash: _original, ...first } = event;
    const { hash: _reordered, ...second } = parsed;
    expect(await computeEventHash(first)).toBe(await computeEventHash(second));
  });
});

function changed(value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return `${value[0] === "a" ? "b" : "a"}${value.slice(1)}`;
  return null;
}

function tamperField(event: Event, fieldIndex: number): unknown {
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(event));
  const payload: Record<string, unknown> = Object.fromEntries(Object.entries(event.payload));
  const fields = [...Object.keys(raw), ...Object.keys(payload).map((key) => `payload.${key}`)];
  const field = fields[fieldIndex % fields.length];
  if (field === undefined) throw new Error("Missing field");
  if (field.startsWith("payload.")) {
    const key = field.slice("payload.".length);
    payload[key] = changed(payload[key]);
    raw.payload = payload;
  } else {
    raw[field] = changed(raw[field]);
  }
  return raw;
}

describe("chain verification", () => {
  it("rejects malformed authenticated heads at runtime", async () => {
    for (const malformed of [
      { count: "1", latestHash: head.latestHash },
      { count: 1, latestHash: "00" },
    ]) {
      await expect(Reflect.apply(verifyChain, undefined, [events, malformed])).rejects.toThrow();
      await expect(
        Reflect.apply(verifyChainStream, undefined, [
          (async function* () {
            yield* events;
          })(),
          malformed,
        ]),
      ).rejects.toThrow();
    }
    for (const malformed of [
      { count: -1, latestHash: genesisHash },
      { count: Number.MAX_SAFE_INTEGER + 1, latestHash: genesisHash },
      { count: 0, latestHash: head.latestHash },
      { fundId: "NOT-A-FUND", count: 0, latestHash: genesisHash },
    ]) {
      expect(() => Reflect.apply(chainHead, undefined, [malformed])).toThrow();
    }
  });

  it("binds integrity results and observed structure to the fund", async () => {
    const other = unwrap(parseFundId("00000000-0000-0000-0000-000000000002"));
    const wrongFundHead = chainHead({
      fundId: other,
      count: head.count,
      latestHash: head.latestHash,
    });
    expect(await verifyChain(events, wrongFundHead)).toEqual({
      ok: false,
      index: 0,
      seq: 1,
      reason: "fund mismatch",
    });
    async function* stream(): AsyncIterable<unknown> {
      yield* events;
    }
    expect(await verifyChainStream(stream(), wrongFundHead)).toMatchObject({
      ok: false,
      index: 0,
      reason: "fund mismatch",
    });
    expect(await checkChainStructure(events)).toEqual({
      status: "structure-consistent",
      observedHead: { fundId, count: head.count, latestHash: head.latestHash },
    });
    const first = events[0];
    if (first === undefined) throw new Error("Missing golden event");
    const { seq: _seq, prev_hash: _prevHash, hash: _hash, ...input } = first;
    const otherEvent = await makeNextEvent(null, { ...input, fund_id: other });
    expect(await checkChainStructure([first, otherEvent])).toEqual({
      status: "broken",
      index: 1,
      seq: 1,
      reason: "fund mismatch",
    });
    expect(await verifyChain([first, otherEvent], head)).toEqual({
      ok: false,
      index: 1,
      seq: 1,
      reason: "fund mismatch",
    });
    async function* mixedStream(): AsyncIterable<unknown> {
      yield first;
      yield otherEvent;
    }
    expect(await checkChainStructureStream(mixedStream())).toMatchObject({
      status: "broken",
      index: 1,
      reason: "fund mismatch",
    });
    const emptyHead = chainHead({ fundId: other, count: 0, latestHash: genesisHash });
    expect(await verifyChain([], emptyHead)).toEqual({
      ok: true,
      count: 0,
      latestHash: genesisHash,
      verifiedAgainst: emptyHead,
    });
    expect(await checkChainStructure([])).toEqual({
      status: "structure-consistent",
      observedHead: { fundId: null, count: 0, latestHash: genesisHash },
    });
  });

  it("cannot treat a structure result as a verified result", async () => {
    const result = await checkChainStructure([]);
    // @ts-expect-error A structure result cannot authorize a verified badge.
    if (result.ok) throw new Error("A structure result exposed ok");
    expect(result.status).toBe("structure-consistent");
  });

  it("stops at the first extra event and closes the stream", async () => {
    const first = events[0];
    if (first === undefined) throw new Error("Missing golden event");
    const oneHead = chainHead({ fundId, count: 1, latestHash: first.hash });
    const expected = { ok: false, index: 1, seq: 2, reason: "unexpected events" };
    const second = events[1];
    if (second === undefined) throw new Error("Missing golden event");
    expect(await verifyChain([first, second], oneHead)).toEqual(expected);
    let closed = false;
    async function* infinite(): AsyncIterable<unknown> {
      try {
        yield first;
        while (true) yield second;
      } finally {
        closed = true;
      }
    }
    expect(await verifyChainStream(infinite(), oneHead)).toEqual(expected);
    expect(closed).toBe(true);

    let syncClosed = false;
    function* sync(): Iterable<unknown> {
      try {
        yield first;
        while (true) yield second;
      } finally {
        syncClosed = true;
      }
    }
    expect(await verifyChain(sync(), oneHead)).toEqual(expected);
    expect(syncClosed).toBe(true);
  });

  it.each([0, 1, 3])("reports the first extra event at zero-based index %i", async (count) => {
    const prefix = events.slice(0, count);
    const expectedHead = chainHead({
      fundId,
      count,
      latestHash: prefix.at(-1)?.hash ?? genesisHash,
    });
    const values = events.slice(0, count + 1);
    const broken = { ok: false, index: count, seq: count + 1, reason: "unexpected events" };
    async function* stream(): AsyncIterable<unknown> {
      yield* values;
    }
    expect(await verifyChain(values, expectedHead)).toEqual(broken);
    expect(await verifyChainStream(stream(), expectedHead)).toEqual(broken);
  });

  it("closes iterators after a failed event or a thrown next call", async () => {
    let structureClosed = false;
    async function* invalid(): AsyncIterable<unknown> {
      try {
        yield { invalid: true };
        yield events[0];
      } finally {
        structureClosed = true;
      }
    }
    expect(await checkChainStructureStream(invalid())).toMatchObject({
      status: "broken",
      index: 0,
    });
    expect(structureClosed).toBe(true);

    let syncStructureClosed = false;
    function* invalidSync(): Iterable<unknown> {
      try {
        yield { invalid: true };
        yield events[0];
      } finally {
        syncStructureClosed = true;
      }
    }
    expect(await checkChainStructure(invalidSync())).toMatchObject({
      status: "broken",
      index: 0,
    });
    expect(syncStructureClosed).toBe(true);

    let errorClosed = false;
    const failed = {
      [Symbol.asyncIterator]() {
        let count = 0;
        return {
          async next(): Promise<IteratorResult<unknown>> {
            if (count++ === 0) return { done: false, value: events[0] };
            throw new Error("source failed");
          },
          async return(): Promise<IteratorResult<unknown>> {
            errorClosed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    await expect(checkChainStructureStream(failed)).rejects.toThrow("source failed");
    expect(errorClosed).toBe(true);
    errorClosed = false;
    await expect(verifyChainStream(failed, head)).rejects.toThrow("source failed");
    expect(errorClosed).toBe(true);
  });

  it("preserves a thrown next error when async cleanup also throws", async () => {
    const sourceError = new Error("source failed");
    const cleanupError = new Error("cleanup failed");
    let returns = 0;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            throw sourceError;
          },
          async return(): Promise<IteratorResult<unknown>> {
            returns++;
            throw cleanupError;
          },
        };
      },
    };
    await expect(checkChainStructureStream(source)).rejects.toBe(sourceError);
    expect(returns).toBe(1);
  });

  it("preserves a thrown sync next error when adapter cleanup also throws", async () => {
    const sourceError = new Error("source failed");
    const cleanupError = new Error("cleanup failed");
    let returns = 0;
    const source: Iterable<unknown> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<unknown> {
            throw sourceError;
          },
          return(): IteratorResult<unknown> {
            returns++;
            throw cleanupError;
          },
        };
      },
    };
    await expect(checkChainStructure(source)).rejects.toBe(sourceError);
    expect(returns).toBe(1);
  });

  it("surfaces cleanup errors on early exits", async () => {
    const asyncError = new Error("async cleanup failed");
    const syncError = new Error("sync cleanup failed");
    let asyncReturns = 0;
    let syncReturns = 0;
    const asyncSource: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            return { done: false, value: { invalid: true } };
          },
          async return(): Promise<IteratorResult<unknown>> {
            asyncReturns++;
            throw asyncError;
          },
        };
      },
    };
    const syncSource: Iterable<unknown> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<unknown> {
            return { done: false, value: { invalid: true } };
          },
          return(): IteratorResult<unknown> {
            syncReturns++;
            throw syncError;
          },
        };
      },
    };
    await expect(checkChainStructureStream(asyncSource)).rejects.toBe(asyncError);
    await expect(checkChainStructure(syncSource)).rejects.toBe(syncError);
    expect(asyncReturns).toBe(1);
    expect(syncReturns).toBe(1);
  });

  it.each(["envelope", "payload"])(
    "rejects raw %s fields that normalization would drop",
    async (level) => {
      const first = events[0];
      if (first === undefined) throw new Error("Missing golden event");
      for (const kind of ["hidden", "symbol", "getter"]) {
        const raw = { ...first, payload: { ...first.payload } };
        const target = level === "envelope" ? raw : raw.payload;
        if (kind === "hidden") Object.defineProperty(target, "hidden", { value: true });
        if (kind === "symbol") Object.defineProperty(target, Symbol("hidden"), { value: true });
        if (kind === "getter") {
          Object.defineProperty(target, "hidden", { enumerable: true, get: () => true });
        }
        expect(parseEvent(raw).ok, `${level} ${kind}`).toBe(false);
        expect(
          await verifyChain([raw], chainHead({ fundId, count: 1, latestHash: first.hash })),
        ).toMatchObject({
          ok: false,
          index: 0,
        });
      }
    },
  );

  it("rejects accessors on known envelope and payload fields before reading them", async () => {
    const first = events[0];
    if (first === undefined) throw new Error("Missing golden event");
    const envelope = { ...first };
    Object.defineProperty(envelope, "type", {
      enumerable: true,
      get() {
        throw new Error("envelope getter ran");
      },
    });
    const payload = { ...first, payload: { ...first.payload } };
    Object.defineProperty(payload.payload, "visibility", {
      enumerable: true,
      get() {
        throw new Error("payload getter ran");
      },
    });
    for (const raw of [envelope, payload]) {
      expect(parseEvent(raw).ok).toBe(false);
      expect(
        await verifyChain([raw], chainHead({ fundId, count: 1, latestHash: first.hash })),
      ).toMatchObject({
        ok: false,
        index: 0,
        reason: "bad envelope",
      });
    }
  });
  it("requires the same canonical pseudonym ID for actors and member references", () => {
    const first = events[0];
    const added = events.find((event) => event.type === "member.added");
    const removed = events.find((event) => event.type === "member.removed");
    if (
      first === undefined ||
      added?.type !== "member.added" ||
      removed?.type !== "member.removed"
    ) {
      throw new Error("Missing golden event");
    }
    const raw = first.fund_id;
    const pseudonym = `psn_${raw}`;
    expect(parseEvent({ ...first, actor: raw }).ok).toBe(false);
    expect(parseEvent({ ...first, actor: pseudonym }).ok).toBe(true);
    for (const member of [added, removed]) {
      expect(parseEvent({ ...member, payload: { ...member.payload, member_id: raw } }).ok).toBe(
        false,
      );
      expect(
        parseEvent({ ...member, payload: { ...member.payload, member_id: pseudonym } }).ok,
      ).toBe(true);
      expect(
        parseEvent({
          ...member,
          payload: { ...member.payload, member_id: pseudonym.toUpperCase() },
        }).ok,
      ).toBe(false);
    }
  });
  it("requires an authenticated head for complete array and stream verification", async () => {
    async function* stream(values: readonly unknown[]): AsyncIterable<unknown> {
      yield* values;
    }
    const shorter = events.slice(0, -1);
    const shortHead = chainHead({
      fundId,
      count: shorter.length,
      latestHash: shorter.at(-1)?.hash ?? genesisHash,
    });
    const first = events[0];
    const last = events.at(-1);
    if (first === undefined || last === undefined) throw new Error("Missing golden event");
    const extra = await makeNextEvent(last, {
      fund_id: first.fund_id,
      type: "fund.visibility_changed",
      version: 1,
      actor: first.actor,
      occurred_at: "2026-01-01T01:00:00.000Z",
      payload: { visibility: "public" },
    });
    const cases = [
      { values: shorter, expected: head, reason: "truncation" },
      { values: events, expected: shortHead, reason: "unexpected events" },
      {
        values: events,
        expected: chainHead({ ...head, latestHash: genesisHash }),
        reason: "wrong hash",
      },
      {
        values: events,
        expected: chainHead({ ...head, count: head.count + 1 }),
        reason: "truncation",
      },
      {
        values: events,
        expected: chainHead({ ...head, count: head.count - 1 }),
        reason: "unexpected events",
      },
      { values: [...events, extra], expected: head, reason: "unexpected events" },
      { values: [], expected: head, reason: "truncation" },
    ];
    for (const { values, expected, reason } of cases) {
      expect(await verifyChain(values, expected)).toMatchObject({ ok: false, reason });
      expect(await verifyChainStream(stream(values), expected)).toMatchObject({
        ok: false,
        reason,
      });
    }
    const emptyHead = chainHead({ fundId, count: 0, latestHash: genesisHash });
    expect(await verifyChain([], emptyHead)).toEqual({
      ok: true,
      count: 0,
      latestHash: genesisHash,
      verifiedAgainst: emptyHead,
    });
    expect(await verifyChainStream(stream([]), emptyHead)).toEqual({
      ok: true,
      count: 0,
      latestHash: genesisHash,
      verifiedAgainst: emptyHead,
    });
    expect(await checkChainStructure(shorter)).toEqual({
      status: "structure-consistent",
      observedHead: { fundId, count: shortHead.count, latestHash: shortHead.latestHash },
    });
    expect(await checkChainStructureStream(stream(shorter))).toEqual({
      status: "structure-consistent",
      observedHead: { fundId, count: shortHead.count, latestHash: shortHead.latestHash },
    });
  });
  it("detects a changed field at that event or its successor", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: events.length - 1 }),
        fc.nat(100),
        async (index, field) => {
          const original = events[index];
          if (original === undefined) throw new Error("Missing event");
          const tampered: unknown[] = [...events];
          tampered[index] = tamperField(original, field);
          const result = await verifyChain(tampered, head);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.index).toBeGreaterThanOrEqual(index);
            expect(result.index).toBeLessThanOrEqual(index + 1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("detects a flipped byte in any event hash at that event", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: events.length - 1 }),
        fc.integer({ min: 0, max: 31 }),
        async (index, byte) => {
          const original = events[index];
          if (original === undefined) throw new Error("Missing event");
          const alteredHash = `${original.hash.slice(0, byte * 2)}${original.hash[byte * 2] === "0" ? "1" : "0"}${original.hash.slice(byte * 2 + 1)}`;
          const tampered: unknown[] = [...events];
          tampered[index] = { ...original, hash: alteredHash };
          expect(await verifyChain(tampered, head)).toEqual({
            ok: false,
            index,
            seq: index + 1,
            reason: "wrong hash",
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("covers every pinned event field and each of its 32 hash bytes", async () => {
    for (const [index, event] of events.entries()) {
      const fieldCount = Object.keys(event).length + Object.keys(event.payload).length;
      for (let field = 0; field < fieldCount; field++) {
        const altered: unknown[] = [...events];
        altered[index] = tamperField(event, field);
        const result = await verifyChain(altered, head);
        expect(result.ok, `undetected field ${field} in event ${index}`).toBe(false);
      }
      for (let byte = 0; byte < 32; byte++) {
        const altered: unknown[] = [...events];
        altered[index] = {
          ...event,
          hash: `${event.hash.slice(0, byte * 2)}${event.hash[byte * 2] === "0" ? "1" : "0"}${event.hash.slice(byte * 2 + 1)}`,
        };
        expect(
          (await verifyChain(altered, head)).ok,
          `undetected hash byte ${byte} in event ${index}`,
        ).toBe(false);
      }
    }
  });

  it("detects removal, reordering, duplication, and insertion", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: events.length - 1 }), async (index) => {
        expect(
          (
            await verifyChain(
              events.filter((_, position) => position !== index),
              head,
            )
          ).ok,
        ).toBe(false);
        const duplicated: unknown[] = [...events];
        duplicated.splice(index, 0, events[index]);
        expect((await verifyChain(duplicated, head)).ok).toBe(false);
        const inserted: unknown[] = [...events];
        inserted.splice(index, 0, { ...events[index], seq: 999 });
        expect((await verifyChain(inserted, head)).ok).toBe(false);
        if (index < events.length - 1) {
          const reordered: unknown[] = [...events];
          const next = reordered[index + 1];
          const current = reordered[index];
          if (next === undefined || current === undefined) throw new Error("Missing event");
          reordered[index] = next;
          reordered[index + 1] = current;
          expect((await verifyChain(reordered, head)).ok).toBe(false);
        }
      }),
    );
  });

  it("reports first-break reasons and verifies async streams", async () => {
    async function* stream(): AsyncIterable<unknown> {
      yield* events;
    }
    expect(await verifyChainStream(stream(), head)).toEqual({
      ok: true,
      count: events.length,
      latestHash: head.latestHash,
      verifiedAgainst: head,
    });
    const badVersion: unknown[] = [...events];
    badVersion[2] = { ...events[2], version: 2 };
    expect(await verifyChain(badVersion, head)).toEqual({
      ok: false,
      index: 2,
      seq: 3,
      reason: "unknown type/version",
    });
    const badTime: unknown[] = [...events];
    badTime[2] = { ...events[2], occurred_at: "2026-01-01T00:02:00Z" };
    expect(await verifyChain(badTime, head)).toEqual({
      ok: false,
      index: 2,
      seq: 3,
      reason: "non-UTC time",
    });
    const backwards: unknown[] = [...events];
    backwards[2] = { ...events[2], occurred_at: events[0]?.occurred_at };
    expect(await verifyChain(backwards, head)).toEqual({
      ok: false,
      index: 2,
      seq: 3,
      reason: "non-monotonic time",
    });
  });

  it("rejects a raw user UUID as actor and unversioned payload additions", () => {
    const first = events[0];
    if (first === undefined) throw new Error("Missing event");
    expect(parseEvent({ ...first, actor: first.fund_id }).ok).toBe(false);
    expect(parseEvent({ ...first, payload: { ...first.payload, name: "PII" } }).ok).toBe(false);
  });
});
