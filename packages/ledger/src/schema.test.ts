import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("defines the canonical envelope required by fund event appends", async () => {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  expect(schema).toMatch(/canonical_envelope\s+TEXT\s+NOT NULL/i);
});
