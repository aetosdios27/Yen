import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ruleset = JSON.parse(read("rulesets/main.json"));
const rule = (type) => ruleset.rules.find((candidate) => candidate.type === type);

test("main merges on CI and Greptile, with stale approvals dismissed and threads resolved", () => {
  const review = rule("pull_request")?.parameters;
  assert.ok(review, "main ruleset must contain a pull_request rule");
  assert.equal(review.dismiss_stale_reviews_on_push, true, "new commits void earlier approvals");
  assert.equal(review.required_review_thread_resolution, true, "review threads must be resolved");
  assert.deepEqual(review.allowed_merge_methods, ["squash"], "squash is the only merge method");
});

test("nobody can bypass the main ruleset", () => {
  assert.equal(ruleset.enforcement, "active");
  assert.deepEqual(ruleset.bypass_actors, []);
});

test("CI Gate, CodeQL and the Greptile gate are required checks", () => {
  const contexts = rule("required_status_checks")?.parameters.required_status_checks.map(
    (check) => check.context,
  );
  assert.ok(contexts?.includes("CI Gate"));
  assert.ok(contexts?.includes("Analyze (javascript-typescript)"));
  assert.ok(contexts?.includes("Greptile 5/5"), "the Greptile 5/5 gate must be required");
  assert.ok(contexts?.includes("Greptile Review"), "the Greptile review check must be required");
});

test("Vercel is a preview signal, never a required merge check", () => {
  const contexts = rule("required_status_checks")?.parameters.required_status_checks.map(
    (check) => check.context,
  );
  assert.ok(contexts, "required status checks must exist");
  assert.equal(
    contexts.some((context) => /vercel/i.test(context)),
    false,
    "Vercel deployments must stay informational; CI Gate remains the merge gate",
  );
});

test("every CODEOWNERS rule names at least two owners so either teammate can approve the other", () => {
  const rules = read("CODEOWNERS")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  assert.ok(
    rules.some(([pattern]) => pattern === "*"),
    "a default * rule must exist",
  );
  const everyone = new Set(rules.flatMap(([, ...owners]) => owners));
  assert.ok(everyone.size >= 2, "CODEOWNERS must name at least two people");
  for (const [pattern, ...owners] of rules) {
    assert.ok(
      owners.length >= 2 && new Set(owners).size === owners.length,
      `${pattern} must list at least two distinct owners`,
    );
    for (const owner of owners) assert.match(owner, /^@[A-Za-z0-9-]+$/, `${pattern}: ${owner}`);
  }
});
