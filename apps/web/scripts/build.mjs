import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: appRoot, encoding: "utf8" }).trim();
const buildId = process.env.YEN_BUILD_ID ?? git("rev-parse", "HEAD^{tree}");
const key = (name, bytes) =>
  createHash("sha256").update(`${buildId}:${name}`).digest().subarray(0, bytes).toString("hex");
const serverActionsKey = createHash("sha256")
  .update(`${buildId}:next-server-actions`)
  .digest("base64");

process.env.YEN_BUILD_ID = buildId;
process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = serverActionsKey;
execFileSync("pnpm", ["exec", "next", "build"], {
  cwd: appRoot,
  env: process.env,
  stdio: "inherit",
});

const distRoot = resolve(appRoot, ".next");
const preview = {
  previewModeId: key("next-preview-id", 16),
  previewModeSigningKey: key("next-preview-signing", 32),
  previewModeEncryptionKey: key("next-preview-encryption", 32),
};
const rewriteJson = (path, update) => {
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

rewriteJson(resolve(distRoot, "server/preview-props.json"), (value) =>
  Object.assign(value, preview),
);
rewriteJson(resolve(distRoot, "prerender-manifest.json"), (value) =>
  Object.assign(value.preview, preview),
);

const requiredFilesPath = resolve(distRoot, "required-server-files.json");
const requiredFiles = JSON.parse(readFileSync(requiredFilesPath, "utf8"));
requiredFiles.config.outputFileTracingRoot = ".";
requiredFiles.config.repoRoot = ".";
requiredFiles.config.turbopack.root = ".";
requiredFiles.appDir = "apps/web";
writeFileSync(requiredFilesPath, `${JSON.stringify(requiredFiles, null, 2)}\n`);
writeFileSync(
  resolve(distRoot, "required-server-files.js"),
  `self.__SERVER_FILES_MANIFEST=${JSON.stringify(requiredFiles)};\n`,
);

const serverReferencePath = resolve(distRoot, "server/server-reference-manifest.json");
rewriteJson(serverReferencePath, (value) => {
  if (Object.keys(value.node).length || Object.keys(value.edge).length) {
    throw new Error("Reproducible public builds do not yet support Next.js server actions.");
  }
  if (value.encryptionKey !== serverActionsKey) {
    throw new Error("Next.js did not use the pinned server action encryption key.");
  }
});
writeFileSync(
  resolve(distRoot, "server/server-reference-manifest.js"),
  `self.__RSC_SERVER_MANIFEST=${JSON.stringify(readFileSync(serverReferencePath, "utf8").trim())};`,
);
