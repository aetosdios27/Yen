import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".sql"]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf("."))) ? [path] : [];
    }),
  );
  return nested.flat();
}

it("leaves fund event schema and lock function definitions to @yen/db migrations", async () => {
  const directory = new URL(".", import.meta.url).pathname;
  const files = await sourceFiles(directory);
  const lockFunction = ["yen_fund", "lock_key"].join("_");
  const eventsTable = ["fund", "events"].join("_");
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const functionDefinition = new RegExp(
      String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?${lockFunction}\b`,
      "i",
    );
    const tableDefinition = new RegExp(
      String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\s*\.\s*)?${eventsTable}\b`,
      "i",
    );
    if (functionDefinition.test(source) || tableDefinition.test(source)) {
      violations.push(file);
    }
  }

  expect(violations).toEqual([]);
});
