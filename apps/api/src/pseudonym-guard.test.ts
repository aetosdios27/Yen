import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("does not cast raw values to PseudonymId in API or ledger production code", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  let output = "";
  try {
    output = execFileSync(
      "rg",
      [
        "-n",
        "--glob",
        "*.ts",
        "--glob",
        "!**/*.test.ts",
        "--glob",
        "!**/*.test-d.ts",
        "as\\s+PseudonymId\\b",
        "apps",
        "packages",
      ],
      { cwd: root, encoding: "utf8" },
    );
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 1) throw error;
  }
  expect(output).toBe("");
});
