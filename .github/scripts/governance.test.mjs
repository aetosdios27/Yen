import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ruleset = JSON.parse(read("rulesets/main.json"));
const rule = (type) => ruleset.rules.find((candidate) => candidate.type === type);

test("main requires a real second reviewer who owns the code", () => {
  const review = rule("pull_request")?.parameters;
  assert.ok(review, "main ruleset must contain a pull_request rule");
  assert.ok(review.required_approving_review_count >= 1, "at least one approval is required");
  assert.equal(review.require_code_owner_review, true, "code-owner review must stay on");
  assert.equal(review.require_last_push_approval, true, "the last pusher cannot approve");
  assert.equal(review.dismiss_stale_reviews_on_push, true, "new commits need a fresh approval");
  assert.equal(review.required_review_thread_resolution, true, "review threads must be resolved");
});

test("nobody can bypass the main ruleset", () => {
  assert.equal(ruleset.enforcement, "active");
  assert.deepEqual(ruleset.bypass_actors, []);
});

test("CI Gate and CodeQL are required checks", () => {
  const contexts = rule("required_status_checks")?.parameters.required_status_checks.map(
    (check) => check.context,
  );
  assert.ok(contexts?.includes("CI Gate"));
  assert.ok(contexts?.includes("Analyze (javascript-typescript)"));
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
