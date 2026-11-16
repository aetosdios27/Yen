import { z } from "zod";
import type { Violation } from "./source-check.js";

export const baselineSchema = z
  .array(
    z.object({
      file: z.string().min(1),
      rule: z.string().min(1),
      count: z.number().int().positive(),
    }),
  )
  .superRefine((entries, context) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.file}\0${entry.rule}`;
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          message: `Duplicate baseline: ${entry.file} ${entry.rule}`,
        });
      seen.add(key);
    }
  });
export type BaselineEntry = z.infer<typeof baselineSchema>[number];

export function countViolations(violations: readonly Violation[]): BaselineEntry[] {
  const entries = new Map<string, BaselineEntry>();
  for (const violation of violations) {
    const key = `${violation.file}\0${violation.rule}`;
    const entry = entries.get(key) ?? { file: violation.file, rule: violation.rule, count: 0 };
    entry.count += violation.count ?? 1;
    entries.set(key, entry);
  }
  return [...entries.values()].sort(
    (first, second) =>
      first.file.localeCompare(second.file) || first.rule.localeCompare(second.rule),
  );
}

export function compareBaseline(
  baseline: readonly BaselineEntry[],
  current: readonly BaselineEntry[],
) {
  const previous = new Map(baseline.map((entry) => [`${entry.file}\0${entry.rule}`, entry.count]));
  const actual = new Map(current.map((entry) => [`${entry.file}\0${entry.rule}`, entry.count]));
  return {
    increases: current.filter(
      (entry) => entry.count > (previous.get(`${entry.file}\0${entry.rule}`) ?? 0),
    ),
    decreases: baseline.filter(
      (entry) => entry.count > (actual.get(`${entry.file}\0${entry.rule}`) ?? 0),
    ),
  };
}

export function lowerBaseline(
  baseline: readonly BaselineEntry[],
  current: readonly BaselineEntry[],
): BaselineEntry[] {
  const counts = new Map(current.map((entry) => [`${entry.file}\0${entry.rule}`, entry.count]));
  return baseline.flatMap((entry) => {
    const count = Math.min(entry.count, counts.get(`${entry.file}\0${entry.rule}`) ?? 0);
    return count === 0 ? [] : [{ ...entry, count }];
  });
}
