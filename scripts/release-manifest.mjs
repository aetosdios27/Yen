import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const git = (ref) => execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
const abiPath = "packages/shared/src/registry/abi.ts";
writeFileSync(
  "release.json",
  `${JSON.stringify(
    {
      sourceCommit: git("HEAD"),
      sourceTree: git("HEAD^{tree}"),
      releaseTag: process.env.YEN_RELEASE_TAG,
      abi: {
        path: abiPath,
        sha256: createHash("sha256").update(readFileSync(abiPath)).digest("hex"),
      },
    },
    null,
    2,
  )}\n`,
);
