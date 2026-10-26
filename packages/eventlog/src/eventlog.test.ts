import { readFileSync } from "node:fs";
import { leafHash, type Result, salt32, toHex } from "@yen/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import {
  canonicalize,
  chainHeadSchema,
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
const head = chainHeadSchema.parse({
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
    const shortHead = chainHeadSchema.parse({
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
        expected: chainHeadSchema.parse({ ...head, latestHash: genesisHash }),
        reason: "wrong hash",
      },
      {
        values: events,
        expected: chainHeadSchema.parse({ ...head, count: head.count + 1 }),
        reason: "truncation",
      },
      {
        values: events,
        expected: chainHeadSchema.parse({ ...head, count: head.count - 1 }),
        reason: "unexpected events",
      },
      { values: [...events, extra], expected: head, reason: "unexpected events" },
      { values: [], expected: head, reason: "truncation" },
      {
        values: [],
        expected: chainHeadSchema.parse({ count: 0, latestHash: first.hash }),
        reason: "truncation",
      },
    ];
    for (const { values, expected, reason } of cases) {
      expect(await verifyChain(values, expected)).toMatchObject({ ok: false, reason });
      expect(await verifyChainStream(stream(values), expected)).toMatchObject({
        ok: false,
        reason,
      });
    }
    const emptyHead = chainHeadSchema.parse({ count: 0, latestHash: genesisHash });
    expect(await verifyChain([], emptyHead)).toEqual({
      ok: true,
      count: 0,
      latestHash: genesisHash,
    });
    expect(await verifyChainStream(stream([]), emptyHead)).toEqual({
      ok: true,
      count: 0,
      latestHash: genesisHash,
    });
    expect(await checkChainStructure(shorter)).toEqual({
      ok: true,
      kind: "structure-only",
      head: shortHead,
    });
    expect(await checkChainStructureStream(stream(shorter))).toEqual({
      ok: true,
      kind: "structure-only",
      head: shortHead,
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
