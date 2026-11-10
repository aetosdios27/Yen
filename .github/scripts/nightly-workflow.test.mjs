import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = read("workflows/nightly-invariants.yml");
const ruleset = JSON.parse(read("rulesets/main.json"));

test("nightly invariants run a million operations with a short manual option", () => {
  assert.match(
    workflow,
    /^on:\n {2}schedule:\n {4}- cron: "23 2 \* \* \*"\n {2}workflow_dispatch:/m,
  );
  assert.match(workflow, /options: \["100000", "1000000"\]/);
  assert.match(workflow, /default: "1000000"/);
  assert.match(workflow, /NIGHTLY_OPS: \$\{\{ github\.event\.inputs\.ops \|\| '1000000' \}\}/);
  assert.match(workflow, /&& 90 \|\| 330/);
  assert.doesNotMatch(workflow, /&& 360/);
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

test("nightly failure reports link to their GitHub Actions run", () => {
  for (const name of ["nightly-chaos.yml", "nightly-invariants.yml"]) {
    const source = read(`workflows/${name}`);
    assert.doesNotMatch(source, /\$GITHUB_RUN_URL/);
    if (name === "nightly-chaos.yml") {
      const body = source.split("\n").find((line) => line.trimStart().startsWith("body="));
      assert.ok(body);
      const output = execFileSync("bash", ["-eu", "-c", `${body}\nprintf '%s' "$body"`], {
        env: {
          GITHUB_SERVER_URL: "https://github.example",
          GITHUB_REPOSITORY: "org/yen",
          GITHUB_RUN_ID: "12345",
        },
        encoding: "utf8",
      });
      assert.match(output, /https:\/\/github\.example\/org\/yen\/actions\/runs\/12345/);
    } else {
      assert.match(
        source,
        /RUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/,
      );
    }
  }
});
