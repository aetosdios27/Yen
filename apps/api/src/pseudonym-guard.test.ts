import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);
const CAST_PATTERN = /\bas\s+PseudonymId\b/;

function productionSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...productionSources(join(directory, entry.name)));
      }
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test-d.ts")
    ) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

it("does not cast raw values to PseudonymId in API or ledger production code", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const offenders = ["apps", "packages"]
    .flatMap((top) => productionSources(join(root, top)))
    .filter((file) => CAST_PATTERN.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(root.length));
  expect(offenders).toEqual([]);
});
