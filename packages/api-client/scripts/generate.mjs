import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const spec = new URL("../../../apps/api/openapi/openapi.json", import.meta.url);
const output = new URL("../src/generated.ts", import.meta.url);
const source = astToString(await openapiTS(spec));
const generated = execFileSync(
  "pnpm",
  ["exec", "biome", "format", `--stdin-file-path=${fileURLToPath(output)}`],
  { input: source, encoding: "utf8" },
);
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== generated) {
    throw new Error("Generated client diff: run pnpm --filter @yen/api-client generate");
  }
} else {
  await writeFile(output, generated);
}
