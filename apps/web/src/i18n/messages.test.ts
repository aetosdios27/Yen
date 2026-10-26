import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { LOCALES } from "./locales";
import { en, type Messages } from "./messages/en";
import { hi } from "./messages/hi";

function isMessages(value: unknown): value is Messages {
  return typeof value === "object" && value !== null;
}

function flatten(node: Messages, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      result.set(path, value);
    } else if (isMessages(value)) {
      for (const [nestedKey, nestedValue] of flatten(value, path)) {
        result.set(nestedKey, nestedValue);
      }
    }
  }
  return result;
}

const enMessages = flatten(en);
const hiMessages = flatten(hi);
const pseudoMessages = flatten(catalog["en-XA"]);

/** Brand names and autonyms are intentionally the same in every locale. */
const IDENTICAL_BY_DESIGN = new Set([
  "app.name",
  "locale.en",
  "locale.hi",
  "designSystem.inputErrorPlaceholder",
]);

const PLACEHOLDER = /\{\w+\}/g;
const JARGON = /\b(hash|block|ledger|wallet|merkle)\b|on-chain/i;
const HINDI_JARGON = /हैश|ब्लॉक|लेजर|वॉलेट/;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[0] ?? "").sort();
}

describe("message catalogue", () => {
  it("has the expected locales", () => {
    expect(LOCALES).toEqual(["en", "hi", "en-XA"]);
    for (const locale of LOCALES) {
      expect(catalog[locale]).toBeDefined();
    }
  });

  it("has exactly the same keys in every locale", () => {
    const keys = [...enMessages.keys()].sort();
    expect([...hiMessages.keys()].sort()).toEqual(keys);
    expect([...pseudoMessages.keys()].sort()).toEqual(keys);
  });

  it("has no empty strings", () => {
    for (const messages of [enMessages, hiMessages, pseudoMessages]) {
      for (const [key, value] of messages) {
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it("translates every string that is not a brand name or autonym", () => {
    for (const [key, value] of enMessages) {
      if (IDENTICAL_BY_DESIGN.has(key)) {
        continue;
      }
      expect(hiMessages.get(key), key).not.toBe(value);
    }
  });

  it("keeps interpolation placeholders intact in Hindi and pseudo-locales", () => {
    for (const [key, value] of enMessages) {
      expect(placeholders(hiMessages.get(key) ?? ""), key).toEqual(placeholders(value));
      expect(placeholders(pseudoMessages.get(key) ?? ""), key).toEqual(placeholders(value));
    }
  });

  it("expands every string in the pseudo-locale", () => {
    for (const [key, value] of enMessages) {
      const pseudo = pseudoMessages.get(key) ?? "";
      expect(pseudo.length, key).toBeGreaterThan(value.length);
      expect(pseudo, key).toContain("⟦");
      expect(pseudo, key).toContain("⟧");
    }
  });

  it("uses plain language instead of technical jargon", () => {
    for (const [key, value] of enMessages) {
      expect(value, key).not.toMatch(JARGON);
    }
    for (const [key, value] of hiMessages) {
      expect(value, key).not.toMatch(HINDI_JARGON);
    }
  });
});
