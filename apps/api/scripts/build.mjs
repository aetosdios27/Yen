import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

function gitValue(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const gitSha = process.env.YEN_BUILD_SHA ?? gitValue("rev-parse", "HEAD");
const buildId = process.env.YEN_BUILD_ID ?? gitValue("rev-parse", "HEAD^{tree}");
const artifactDigest = process.env.YEN_ARTIFACT_DIGEST ?? "";
const releaseTag = process.env.YEN_RELEASE_TAG ?? "";
const provenanceUrl = process.env.YEN_PROVENANCE_URL ?? "";
if (artifactDigest !== "" && !/^sha256:[a-f0-9]{64}$/.test(artifactDigest)) {
  throw new Error("YEN_ARTIFACT_DIGEST must be sha256 followed by a full lowercase digest");
}
if (!/^[0-9a-f]{40}$/.test(gitSha) || !/^[0-9a-f]{40}$/.test(buildId)) {
  throw new Error("YEN_BUILD_SHA and YEN_BUILD_ID must be full lowercase Git object IDs");
}

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });

const path = new URL("../dist/build-info.js", import.meta.url);
const source = await readFile(path, "utf8");
await writeFile(
  path,
  source
    .replaceAll("__YEN_BUILD_SHA__", gitSha)
    .replaceAll("__YEN_BUILD_ID__", buildId)
    .replaceAll("__YEN_ARTIFACT_DIGEST__", artifactDigest)
    .replaceAll("__YEN_RELEASE_TAG__", releaseTag)
    .replaceAll("__YEN_PROVENANCE_URL__", provenanceUrl),
);
