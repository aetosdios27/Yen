import { basename } from "node:path";
import {
  findPatterns,
  isTest,
  type PatternRule,
  type Source,
  type Violation,
  withoutComments,
} from "./source-check.js";

export const codeRules = [
  {
    name: "untracked-todo",
    pattern: /\bTODO\b(?![^\n]*\bYEN-\d+\b)/g,
    message: "Reference a YEN issue on the TODO line.",
  },
  {
    name: "ts-suppression",
    pattern: /@ts-(?:ignore|expect-error)\b/g,
    message: "Fix the type error instead of suppressing it.",
  },
] satisfies readonly PatternRule[];

const defaultExport: PatternRule = {
  name: "default-export",
  pattern: /\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b/g,
  message: "Use a named export outside Next.js entry files.",
};
const apiFetch: PatternRule = {
  name: "api-fetch",
  pattern: /\bfetch\s*\(/g,
  message: "Call the API through src/lib/api-client.ts.",
};

function isNextEntry(file: string): boolean {
  return (
    /^apps\/[^/]+\/src\/(?:proxy|middleware)\.[jt]s$/.test(file) ||
    (/^apps\/[^/]+\/src\/app\//.test(file) &&
      /^(?:page|layout|template|loading|error|global-error|not-found|default|route|manifest|sitemap|robots|icon|apple-icon|opengraph-image|twitter-image)\.[jt]sx?$/.test(
        basename(file),
      ))
  );
}

function checkSize(source: Source): Violation[] {
  if (isTest(source.file)) return [];
  const limit = source.file.endsWith(".tsx") ? 200 : 300;
  const lines = source.text.trimEnd().split("\n").length;
  return lines <= limit
    ? []
    : [
        {
          file: source.file,
          line: limit + 1,
          rule: "file-size",
          message: `File has ${lines} lines; limit is ${limit}.`,
          count: lines - limit,
        },
      ];
}

export function checkCode(source: Source): Violation[] {
  const cleaned = { ...source, text: withoutComments(source.text) };
  const rules = isTest(source.file)
    ? codeRules.filter((rule) => rule.name !== "ts-suppression")
    : codeRules;
  const violations = [...checkSize(source), ...findPatterns(source, rules)];
  if (!isNextEntry(source.file)) violations.push(...findPatterns(cleaned, [defaultExport]));
  if (
    source.file.startsWith("apps/") &&
    /\/index\.[jt]sx?$/.test(source.file) &&
    /^\s*(?:export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?\s*)+$/.test(
      cleaned.text,
    )
  ) {
    violations.push({
      file: source.file,
      line: 1,
      rule: "barrel-index",
      message: "Import from the owning module instead of an app barrel.",
    });
  }
  if (source.file.startsWith("apps/web/src/") && source.file !== "apps/web/src/lib/api-client.ts") {
    violations.push(...findPatterns(cleaned, [apiFetch]));
  }
  return violations;
}
