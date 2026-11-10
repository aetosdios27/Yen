import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const directory = new URL("../workflows/", import.meta.url);
const externalAllowed = new Set([
  "pnpm/action-setup",
  "gitleaks/gitleaks-action",
  "amannn/action-semantic-pull-request",
  "anchore/sbom-action",
  "sigstore/cosign-installer",
]);
for (const file of readdirSync(directory).filter((name) => /\.ya?ml$/.test(name))) {
  test(`${file}: every action is allow-listed and SHA pinned`, () => {
    const source = readFileSync(new URL(file, directory), "utf8");
    for (const [, action, sha] of source.matchAll(/\buses:\s*([^@\s]+)@([^\s]+)/g)) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      assert.ok(
        action.startsWith("actions/") ||
          action.startsWith("github/") ||
          externalAllowed.has(action),
        action,
      );
    }
  });
}

test("release installer supports Cosign v3 with a pinned bootstrap checksum", () => {
  const release = readFileSync(new URL("release.yml", directory), "utf8");
  assert.match(release, /sigstore\/cosign-installer@756fe2d284c7292c4e9b62c8a28f1e5629c59532/);
  assert.match(release, /cosign-release: v3\.1\.4/);
});
