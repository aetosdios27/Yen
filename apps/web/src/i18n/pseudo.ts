import type { Messages } from "./messages/en";

const ACCENTED: Record<string, string> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "q",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
};

const PLACEHOLDER = /^\{\w+\}$/;

function accentText(text: string): string {
  return text.replace(/[a-z]/gi, (letter) => {
    const accented = ACCENTED[letter.toLowerCase()];
    if (accented === undefined) {
      return letter;
    }
    return letter === letter.toUpperCase() ? accented.toUpperCase() : accented;
  });
}

/**
 * Expands a string with accents and trailing padding, like the common `en-XA`
 * pseudo-locale. Interpolation placeholders are left untouched so translated
 * values still resolve.
 */
export function pseudoLocalize(message: string): string {
  const accented = message
    .split(/(\{\w+\})/)
    .map((part) => (PLACEHOLDER.test(part) ? part : accentText(part)))
    .join("");
  const padding = "·".repeat(Math.max(4, Math.ceil(message.length * 0.4)));
  return `⟦${accented}${padding}⟧`;
}

function isMessages(value: unknown): value is Messages {
  return typeof value === "object" && value !== null;
}

/** Builds an expanded pseudo-locale from the English catalogue. */
export function pseudoLocalizeMessages(messages: Messages): Messages {
  const result: Record<string, string | Messages> = {};
  for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = pseudoLocalize(value);
    } else if (isMessages(value)) {
      result[key] = pseudoLocalizeMessages(value);
    }
  }
  // The loop preserves the English catalogue's shape; TypeScript cannot infer that.
  return result as unknown as Messages;
}
