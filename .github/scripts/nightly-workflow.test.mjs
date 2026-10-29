import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = read("workflows/nightly-invariants.yml");
const ruleset = JSON.parse(read("rulesets/main.json"));

test("nightly invariants run at scale and allow a million-operation manual run", () => {
  assert.match(
    workflow,
    /^on:\n {2}schedule:\n {4}- cron: "23 2 \* \* \*"\n {2}workflow_dispatch:/m,
  );
  assert.match(workflow, /options: \["100000", "1000000"\]/);
  assert.match(workflow, /NIGHTLY_OPS: \$\{\{ github\.event\.inputs\.ops \|\| '100000' \}\}/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /--ops "\$NIGHTLY_OPS"/);
  assert.match(workflow, /backup:restore/);
});

test("only the alert job can write issues and it records the run and seed", () => {
  const alert = workflow.split("  alert:\n")[1] ?? "";
  assert.match(alert, /permissions:\n {6}issues: write/);
  assert.match(alert, /gh issue list/);
  assert.match(alert, /gh issue edit/);
  assert.match(alert, /gh issue create/);
  assert.match(alert, /RUN_URL:/);
  assert.match(alert, /SEED:/);
  assert.doesNotMatch(
    workflow.split("  invariants:\n")[1]?.split("  alert:\n")[0] ?? "",
    /issues: write/,
  );
  assert.equal(
    ruleset.rules
      .find((rule) => rule.type === "required_status_checks")
      ?.parameters.required_status_checks.some((check) => /nightly/i.test(check.context)),
    false,
  );
});

test("nightly workflow uses only full-SHA pinned actions", () => {
  const usesLines = workflow.split("\n").filter((line) => /^\s*- uses:/.test(line));
  assert.equal(usesLines.length, 3);
  for (const line of usesLines) {
    assert.match(line, /^\s*- uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s+v[\w.-]+$/);
  }
});
