import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle } from "../src/verify.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const vectorsDir = resolve(repo, "packages/verifier/vectors/v1");
const pythonVerifier = resolve(repo, "verifiers/python/yen_verify.py");
const index = JSON.parse(await readFile(resolve(vectorsDir, "index.json"), "utf8")) as {
  version: number;
  vectors: { file: string; valid: boolean; reason_code: string | null }[];
};
if (index.version !== 1 || index.vectors.length < 2) throw new Error("invalid vector index");
for (const item of index.vectors) {
  const vector = JSON.parse(await readFile(resolve(vectorsDir, item.file), "utf8")) as {
    name: string;
    bundle: unknown;
  };
  const checks = verifyBundle(vector.bundle);
  const failed = checks.find((check) => !check.ok);
  const tsResult = { valid: !failed, reason_code: failed?.reasonCode ?? null };
  const py = spawnSync("python3", [pythonVerifier, resolve(vectorsDir, item.file)], {
    encoding: "utf8",
  });
  if (py.status !== 0) throw new Error(`${item.file}: Python verifier failed: ${py.stderr}`);
  const pyResult = JSON.parse(py.stdout) as typeof tsResult;
  if (
    JSON.stringify(tsResult) !==
    JSON.stringify(
      item.valid
        ? { valid: true, reason_code: null }
        : { valid: false, reason_code: item.reason_code },
    )
  )
    throw new Error(
      `${item.file}: TypeScript verdict disagrees with published expectation: ${JSON.stringify(tsResult)}`,
    );
  if (pyResult.valid !== tsResult.valid || pyResult.reason_code !== tsResult.reason_code)
    throw new Error(
      `${item.file}: implementations disagree; TS=${JSON.stringify(tsResult)} Python=${JSON.stringify(pyResult)}`,
    );
  console.log(`${item.file}: ${tsResult.valid ? "valid" : tsResult.reason_code}`);
}
const actual = (await readdir(vectorsDir)).filter(
  (file) => file.endsWith(".json") && file !== "index.json",
).length;
if (actual !== index.vectors.length)
  throw new Error(`index lists ${index.vectors.length} vectors but directory contains ${actual}`);
console.log(`Both implementations agree on all ${actual} vectors.`);
