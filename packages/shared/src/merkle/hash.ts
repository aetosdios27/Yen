declare const hash32Brand: unique symbol;
declare const salt32Brand: unique symbol;

export type Hash32 = Uint8Array & { readonly [hash32Brand]: "Hash32" };

export type Salt32 = Uint8Array & { readonly [salt32Brand]: "Salt32" };

function copy32(bytes: Uint8Array, name: string): Uint8Array {
  if (bytes.length !== 32) {
    throw new RangeError(`${name} must be 32 bytes, got ${bytes.length}`);
  }
  return Uint8Array.from(bytes);
}

export function hash32(bytes: Uint8Array): Hash32 {
  return copy32(bytes, "Hash32") as Hash32;
}

export function salt32(bytes: Uint8Array): Salt32 {
  return copy32(bytes, "Salt32") as Salt32;
}

const lowercaseHex = /^(?:[0-9a-f]{2})*$/;

// Rejecting uppercase gives each byte sequence exactly one hex spelling.
export function fromHex(hex: string): Uint8Array {
  if (!lowercaseHex.test(hex)) {
    throw new RangeError("Expected lowercase hex with an even number of digits");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export async function sha256(...parts: readonly Uint8Array[]): Promise<Hash32> {
  const input = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  return hash32(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input)));
}
