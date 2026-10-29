import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = read("workflows/release.yml");
const settings = read("scripts/apply-repo-settings.sh");

test("release workflow is tag-only and does not deploy", () => {
  assert.match(workflow, /^on:\n {2}push:\n {4}tags: \["v\*"\]$/m);
  assert.doesNotMatch(workflow, /pull_request_target|vercel|deploy/i);
});

test("every release action is pinned to a full SHA and names its upstream tag", () => {
  const usesLines = workflow.split("\n").filter((line) => /^\s*(?:-\s*)?uses:/.test(line));
  assert.equal(usesLines.length, 10);
  for (const line of usesLines) {
    assert.match(
      line,
      /^\s*(?:-\s*)?uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s+v[\w.-]+$/,
      `action must use a verified full-SHA reference with its version comment: ${line.trim()}`,
    );
  }
});

test("build, signing and release publishing use separate minimal permissions", () => {
  const build = workflow.split("  build:\n")[1]?.split("  sign:\n")[0] ?? "";
  const sign = workflow.split("  sign:\n")[1]?.split("  publish:\n")[0] ?? "";
  const publish = workflow.split("  publish:\n")[1] ?? "";
  assert.match(build, /\n {4}permissions:\n {6}contents: read\n/);
  assert.match(
    sign,
    /\n {4}permissions:\n {6}contents: read\n {6}id-token: write\n {6}attestations: write\n/,
  );
  assert.match(publish, /\n {4}permissions:\n {6}contents: write\n/);
  assert.doesNotMatch(build, /id-token: write|attestations: write|contents: write/);
  assert.doesNotMatch(publish, /id-token: write|attestations: write/);
});

test("new external release actions are in the repository allow-list", () => {
  assert.match(settings, /patterns_allowed\[\]=anchore\/sbom-action@\*/);
  assert.match(settings, /patterns_allowed\[\]=sigstore\/cosign-installer@\*/);
});
