import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

/** 360 px is the narrowest phone the pilot supports, with no horizontal scroll. */
const NARROWEST_PHONE_PX = 360;

function componentFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) continue;
      found.push(full);
    }
  };
  walk(srcRoot);
  return found;
}

/**
 * Hindi runs 15-20% longer than English, so a fixed width that fits in English
 * can clip a Hindi label. This scans the class names rather than a rendered DOM
 * because jsdom does no layout.
 */
function violations(source: string): string[] {
  const found: string[] = [];
  const wide = /(?:min-)?w-\[(\d+)px\]/g;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = wide.exec(source);
    if (match === null) break;
    const width = Number(match[1]);
    if (width > NARROWEST_PHONE_PX) found.push(`fixed width ${width}px`);
  }
  if (/\bwhitespace-nowrap\b/.test(source)) found.push("whitespace-nowrap");
  return found;
}

describe("360 px mobile guard", () => {
  it("keeps every component inside the narrowest supported phone", () => {
    const offenders = componentFiles().flatMap((file) =>
      violations(fs.readFileSync(file, "utf8")).map(
        (reason) => `${path.relative(srcRoot, file)}: ${reason}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("flags an oversized fixed width", () => {
    expect(violations(`<div className="w-[420px]" />`)).toEqual(["fixed width 420px"]);
    expect(violations(`<div className="min-w-[361px]" />`)).toEqual(["fixed width 361px"]);
  });

  it("accepts a width at or below the narrowest phone", () => {
    expect(violations(`<div className="w-[360px] max-w-full" />`)).toEqual([]);
  });

  it("flags text that cannot wrap", () => {
    expect(violations(`<span className="whitespace-nowrap" />`)).toEqual(["whitespace-nowrap"]);
  });
});
