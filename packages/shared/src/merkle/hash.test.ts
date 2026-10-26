import { describe, expect, it } from "vitest";
import { fromHex, hash32, salt32, sha256, toHex } from "./hash.js";

describe("hex", () => {
  it("round-trips bytes through lowercase hex", () => {
    const bytes = Uint8Array.of(0x00, 0x0f, 0xa0, 0xff);
    expect(toHex(bytes)).toBe("000fa0ff");
    expect(fromHex("000fa0ff")).toEqual(bytes);
  });

  it.each(["0", "abc", "zz", "0x00", "AB", " 00", "00 "])("rejects %j", (bad) => {
    expect(() => fromHex(bad)).toThrow(RangeError);
  });
});

describe("hash32 and salt32", () => {
  it.each([0, 31, 33, 64])("reject %i bytes", (length) => {
    expect(() => hash32(new Uint8Array(length))).toThrow(RangeError);
    expect(() => salt32(new Uint8Array(length))).toThrow(RangeError);
  });

  it("copy their input so later mutation of the source cannot change them", () => {
    const source = new Uint8Array(32);
    const hash = hash32(source);
    source[0] = 1;
    expect(hash[0]).toBe(0);
  });
});

describe("sha256", () => {
  it("hashes the concatenation of its parts", async () => {
    expect(toHex(await sha256(new TextEncoder().encode("ab"), new TextEncoder().encode("c")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
