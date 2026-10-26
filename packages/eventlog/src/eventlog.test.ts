import { readFileSync } from "node:fs";
import { leafHash, type Result, salt32, toHex } from "@yen/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import {
  canonicalize,
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
  z.strictObject({ name: z.string(), input: z.unknown(), canonical: z.string() }),
);
const goldenSchema = z.strictObject({
  domain_utf8: z.string(),
  genesis_hash: z.string(),
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
const head = { count: events.length, latestHash: events.at(-1)?.hash ?? genesisHash };

describe("RFC 8785 canonical JSON", () => {
  it("matches the published RFC number example", () => {
    expect(canonicalize([Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27]",
    );
  });

  it.each(vectors)("matches independent Python vector $name", ({ input, canonical }) => {
    expect(canonicalize(input)).toBe(canonical);
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
  it("pins every v1 event, canonical string, and hash", async () => {
    expect(events.length).toBe(24);
    expect(eventHashDomain).toBe(golden.domain_utf8);
    expect(genesisHash).toBe(golden.genesis_hash);
    expect(
      head.latestHash,
      "these hashes are frozen: a change here is a breaking change to every recorded event",
    ).toBe("46c951754c0e24e3c8a9d6e3d789028b9db2a24f621129009bb67346c9df0d72");
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
      expect(eventSubjectId(event)).toMatch(/^[0-9a-f-]{36}$/);
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
    expect(await verifyChain(badVersion)).toEqual({
      ok: false,
      index: 2,
      seq: 3,
      reason: "unknown type/version",
    });
    const badTime: unknown[] = [...events];
    badTime[2] = { ...events[2], occurred_at: "2026-01-01T00:02:00Z" };
    expect(await verifyChain(badTime)).toEqual({
      ok: false,
      index: 2,
      seq: 3,
      reason: "non-UTC time",
    });
    const backwards: unknown[] = [...events];
    backwards[2] = { ...events[2], occurred_at: events[0]?.occurred_at };
    expect(await verifyChain(backwards)).toEqual({
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
