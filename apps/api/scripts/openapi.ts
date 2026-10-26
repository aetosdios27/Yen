import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { openApiDocument } from "../src/app.js";

const path = new URL("../openapi/openapi.json", import.meta.url);
const generated = execFileSync(
  "pnpm",
  ["exec", "biome", "format", "--stdin-file-path=openapi/openapi.json"],
  {
    input: JSON.stringify(openApiDocument()),
    encoding: "utf8",
  },
);
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== generated) {
    throw new Error("OpenAPI diff: run pnpm --filter @yen/api openapi:generate");
  }
} else {
  await writeFile(path, generated);
}
