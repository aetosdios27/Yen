#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [archive, checksums, attestation] = process.argv.slice(2);
if (!archive || !checksums || !attestation) {
  console.error(
    "Usage: node scripts/test-tampered-artifact.mjs <archive> <SHA256SUMS> <attestation-input>",
  );
  process.exit(2);
}
const temp = await mkdtemp(join(tmpdir(), "yen-tamper-"));
try {
  const copy = join(temp, archive.split("/").at(-1));
  await copyFile(archive, copy);
  const bytes = await readFile(copy);
  if (bytes.length === 0) throw new Error("Cannot tamper with an empty archive");
  bytes[0] ^= 1;
  await writeFile(copy, bytes);
  const verifier = fileURLToPath(new URL("./verify-release", import.meta.url));
  const result = spawnSync(process.execPath, [verifier, copy, checksums, attestation], {
    encoding: "utf8",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status === 0 || !result.stderr.includes("RELEASE_VERIFY_DIGEST_MISMATCH")) {
    console.error("Tampered archive was not rejected with the expected digest mismatch.");
    process.exit(1);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
