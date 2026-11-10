import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const turbo = JSON.parse(read("turbo.json"));

// These specific entry points import workspace packages; this is not an import analyzer.
for (const [workflow, task, pkg] of [
  ["ci.yml", "test:a11y", "@yen/web"],
  ["load-test.yml", "test", "@yen/load-tests"],
  ["load-test.yml", "test:load", "@yen/load-tests"],
]) {
  test(`${workflow}: ${pkg} ${task} builds dependencies through Turbo`, () => {
    const text = read(`.github/workflows/${workflow}`);
    assert.ok(text.includes(`run: pnpm turbo run ${task} --filter=${pkg}`));
    assert.ok(turbo.tasks[task].dependsOn.includes("^build"));
    assert.doesNotMatch(text, new RegExp(`run: pnpm --filter ${pkg} ${task}(?:\\s|$)`));
    if (task === "test:load") {
      assert.equal(turbo.tasks[task].cache, false);
      assert.ok(text.includes("-- --duration 5 --connections 10 --verify-state"));
    }
  });
}
