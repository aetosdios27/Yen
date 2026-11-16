import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  baselineSchema,
  compareBaseline,
  countViolations,
  lowerBaseline,
} from "./check-baseline.js";
import type { Source, Violation } from "./source-check.js";

export function runSourceCheck(options: {
  name: "design" | "code";
  root: string;
  sources: Source[];
  check: (source: Source) => Violation[];
  update: boolean;
}): number {
  const { name, root, sources, check, update } = options;
  const path = join(root, `scripts/baselines/${name}.json`);
  const baseline = baselineSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const violations = sources.flatMap(check);
  const current = countViolations(violations);
  const next = update ? lowerBaseline(baseline, current) : baseline;
  if (update) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  const { increases, decreases } = compareBaseline(next, current);
  for (const entry of increases) {
    for (const violation of violations.filter(
      (item) => item.file === entry.file && item.rule === entry.rule,
    )) {
      console.error(`${violation.file}:${violation.line} ${violation.rule} ${violation.message}`);
    }
  }
  for (const entry of decreases) {
    console.error(
      `${entry.file}:1 ${entry.rule} baseline can shrink, run pnpm check:${name} --update`,
    );
  }
  console.log(
    `check:${name}: ${next.length} baseline entries, ${next.reduce((total, entry) => total + entry.count, 0)} total count; ${increases.length} increases, ${decreases.length} stale entries`,
  );
  return increases.length > 0 || decreases.length > 0 ? 1 : 0;
}
