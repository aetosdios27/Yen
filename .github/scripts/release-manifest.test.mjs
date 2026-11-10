import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("release manifest binds the packaged ABI to the checked-out commit", () => {
  const cwd = mkdtempSync(join(tmpdir(), "yen-release-manifest-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git("init", "--quiet");
    const abi = "export const rootRegistryAbi = [] as const;\n";
    mkdirSync(join(cwd, "packages/shared/src/registry"), { recursive: true });
    writeFileSync(join(cwd, "packages/shared/src/registry/abi.ts"), abi);
    git("add", ".");
    git(
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/release-manifest.mjs", import.meta.url))],
      {
        cwd,
        env: { ...process.env, YEN_RELEASE_TAG: "v1.2.3" },
      },
    );
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, "release.json"), "utf8")), {
      sourceCommit: git("rev-parse", "HEAD"),
      sourceTree: git("rev-parse", "HEAD^{tree}"),
      releaseTag: "v1.2.3",
      abi: {
        path: "packages/shared/src/registry/abi.ts",
        sha256: createHash("sha256").update(abi).digest("hex"),
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
