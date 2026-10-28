import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("keeps the canonical envelope definition in the fund event migration", async () => {
  const migration = await readFile(
    new URL("../../db/migrations/0003_fund_events.sql", import.meta.url),
    "utf8",
  );
  expect(migration).toMatch(/canonical_envelope\s+text\s+NOT NULL/i);
});
