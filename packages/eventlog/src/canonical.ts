function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function canonicalize(value: unknown): string {
  const active = new Set<object>();

  function encode(input: unknown): string {
    if (input === null) return "null";
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "string") {
      if (!validUnicode(input)) throw new TypeError("Canonical JSON rejects lone surrogates");
      return JSON.stringify(input);
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("Canonical JSON requires finite numbers");
      return JSON.stringify(input);
    }
    if (typeof input !== "object") throw new TypeError("Canonical JSON requires JSON values");
    if (active.has(input)) throw new TypeError("Canonical JSON rejects cycles");
    active.add(input);
    try {
      if (Array.isArray(input)) {
        const parts: string[] = [];
        for (let i = 0; i < input.length; i++) {
          if (!Object.hasOwn(input, i)) throw new TypeError("Canonical JSON rejects sparse arrays");
          parts.push(encode(input[i]));
        }
        return `[${parts.join(",")}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Canonical JSON requires plain objects");
      }
      if (Object.getOwnPropertySymbols(input).length !== 0) {
        throw new TypeError("Canonical JSON rejects symbol keys");
      }
      const parts: string[] = [];
      for (const key of Object.keys(input).sort()) {
        if (!validUnicode(key)) throw new TypeError("Canonical JSON rejects lone surrogates");
        parts.push(
          `${JSON.stringify(key)}:${encode(Object.getOwnPropertyDescriptor(input, key)?.value)}`,
        );
      }
      return `{${parts.join(",")}}`;
    } finally {
      active.delete(input);
    }
  }

  return encode(value);
}
