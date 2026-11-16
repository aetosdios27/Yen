import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { compareBaseline } from "./check-baseline.js";
import { checkDesign } from "./design-rules.js";
import { runSourceCheck } from "./run-source-check.js";
import { readSources } from "./source-check.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it.each([
  ['<div className="dark:bg-primary" />', "dark-variant"],
  ['<div className="text-red-500" />', "palette-class"],
  ['<div style={{ color: "red" }} />', "inline-style"],
  ['<div className="p-[13px]" />', "arbitrary-value"],
  ['const colour = "#ffffff";', "colour-literal"],
  ['<div className="text-ink/50" />', "text-opacity"],
  [".value { display: block !important; }", "important"],
])("rejects a source regression: %s", (text, rule) => {
  expect(
    checkDesign({ file: "apps/web/src/example.tsx", text }).some((item) => item.rule === rule),
  ).toBe(true);
});

it("accepts semantic token classes", () => {
  expect(
    checkDesign({
      file: "apps/web/src/example.tsx",
      text: '<p className="text-body text-ink bg-surface" />',
    }),
  ).toEqual([]);
});

it("rejects a new file or a larger count in the recorded baseline", () => {
  const baseline = [{ file: "existing.tsx", rule: "palette-class", count: 1 }];
  expect(
    compareBaseline(baseline, [
      { file: "existing.tsx", rule: "palette-class", count: 2 },
      { file: "new.tsx", rule: "palette-class", count: 1 },
    ]).increases,
  ).toHaveLength(2);
});

it("allows update to remove debt but never to approve a new violation", () => {
  const root = mkdtempSync(join(tmpdir(), "yen-design-"));
  directories.push(root);
  mkdirSync(join(root, "scripts/baselines"), { recursive: true });
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  const file = "apps/web/src/example.tsx";
  const baselinePath = join(root, "scripts/baselines/design.json");
  writeFileSync(baselinePath, JSON.stringify([{ file, rule: "palette-class", count: 2 }]));
  const run = () =>
    runSourceCheck({
      name: "design",
      root,
      sources: readSources(root, ["apps/web/src"]),
      check: checkDesign,
      update: true,
    });
  writeFileSync(join(root, file), 'const classes = "text-red-500";');
  expect(run()).toBe(0);
  expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual([
    { file, rule: "palette-class", count: 1 },
  ]);
  writeFileSync(join(root, file), 'const classes = "text-red-500 bg-blue-600";');
  expect(run()).toBe(1);
  expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual([
    { file, rule: "palette-class", count: 1 },
  ]);
});

it("cannot bless a dark-mode variant through update", () => {
  const root = mkdtempSync(join(tmpdir(), "yen-design-dark-"));
  directories.push(root);
  mkdirSync(join(root, "scripts/baselines"), { recursive: true });
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  const baselinePath = join(root, "scripts/baselines/design.json");
  writeFileSync(baselinePath, "[]");
  writeFileSync(join(root, "apps/web/src/example.tsx"), '<div className="dark:bg-primary" />');
  for (const update of [false, true]) {
    expect(
      runSourceCheck({
        name: "design",
        root,
        sources: readSources(root, ["apps/web/src"]),
        check: checkDesign,
        update,
      }),
    ).toBe(1);
  }
  expect(JSON.parse(readFileSync(baselinePath, "utf8"))).toEqual([]);
});
