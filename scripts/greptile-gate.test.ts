import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate } from "./greptile-gate.mjs";

const headSha = "7bea98259322d49a439a178ad432bbef11d36e6c";
const fixture = (number: 30 | 24 | 27) =>
  readFileSync(new URL(`./__fixtures__/pr-${number}-body.txt`, import.meta.url), "utf8");

const review = (score: string, reviewedSha = headSha) => `
<!-- greptile_comment -->
<h2>Confidence Score: ${score}/5</h2>
<!-- greptile_confidence_score:${score} -->
<sub>Last reviewed commit: [abc](https://github.com/a/b/commit/${reviewedSha})</sub>
<!-- /greptile_comment -->
`;

describe("evaluate Greptile reviews", () => {
  it("passes a matching 5/5 review", () => {
    expect(evaluate({ body: fixture(30), headSha })).toMatchObject({ ok: true });
  });

  it.each(["4", "3"])("rejects a %s/5 review", (score) => {
    expect(evaluate({ body: review(score), headSha }).ok).toBe(false);
  });

  it("rejects live 4/5 and 3/5 fixtures", () => {
    expect(evaluate({ body: fixture(24), headSha }).ok).toBe(false);
    expect(evaluate({ body: fixture(27), headSha }).ok).toBe(false);
  });

  it("rejects a stale reviewed commit", () => {
    expect(evaluate({ body: review("5", "0".repeat(40)), headSha }).ok).toBe(false);
  });

  it("fails with a waiting reason when no Greptile block exists", () => {
    expect(evaluate({ body: "No review yet", headSha })).toEqual({
      ok: false,
      reason: `waiting for a Greptile review of ${headSha}`,
    });
  });

  it("rejects multiple blocks", () => {
    expect(evaluate({ body: review("5") + review("5"), headSha }).ok).toBe(false);
  });

  it("rejects a marker and heading mismatch", () => {
    expect(
      evaluate({
        body: review("5").replace("Confidence Score: 5/5", "Confidence Score: 4/5"),
        headSha,
      }).ok,
    ).toBe(false);
  });

  it("ignores score text outside the review block", () => {
    const body = `Confidence Score: 5/5\n<!-- greptile_confidence_score:5 -->\n${review("4")}`;
    expect(evaluate({ body, headSha }).ok).toBe(false);
  });

  it.each(["x", "6", "-1"])("rejects invalid score %s", (score) => {
    expect(evaluate({ body: review(score), headSha }).ok).toBe(false);
  });
});
