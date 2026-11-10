import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("CI Gate requires workflow linting through Verify", () => {
  const ci = read("workflows/ci.yml");
  const verify = ci.split("  verify:\n")[1]?.split("  secrets:\n")[0] ?? "";
  const step =
    verify.split("      - name: Lint GitHub Actions workflows\n")[1]?.split("\n      - ")[0] ?? "";
  assert.match(step, /^ {8}run: bash .github\/scripts\/lint-workflows.sh$/m);
  assert.doesNotMatch(step, /if:|continue-on-error:/);
  assert.doesNotMatch(verify, /continue-on-error:/);
  const gate = ci.split("  gate:\n")[1] ?? "";
  assert.match(gate, /needs: \[verify,/);
  assert.match(gate, /\.verify.result == "success"/);
});

test("workflow lint verifies the pinned archive before executing it on every workflow", () => {
  const script = read("scripts/lint-workflows.sh");
  assert.match(script, /set -euo pipefail/);
  assert.match(
    script,
    /https:\/\/github.com\/rhysd\/actionlint\/releases\/download\/v1.7.12\/actionlint_1.7.12_linux_amd64.tar.gz/,
  );
  assert.match(script, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.ok(script.indexOf("sha256sum --check --strict") < script.indexOf("tar -xzf"));
  assert.match(script, /"\$tool_dir\/actionlint" -color .github\/workflows\/\*\.yml/);
});
