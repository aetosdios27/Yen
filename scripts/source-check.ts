import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Source = { file: string; text: string };
export type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
  count?: number;
};
export type PatternRule = { name: string; pattern: RegExp; message: string };

export function isTest(file: string): boolean {
  return (
    /(?:^|\/)(?:__tests__|test|tests)\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

export function withoutComments(text: string): string {
  return text.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
    (whole, string: string | undefined) => string ?? whole.replace(/[^\n]/g, " "),
  );
}

export function findPatterns(source: Source, rules: readonly PatternRule[]): Violation[] {
  return rules.flatMap((rule) =>
    [...source.text.matchAll(rule.pattern)].map((match) => ({
      file: source.file,
      line: source.text.slice(0, match.index).split("\n").length,
      rule: rule.name,
      message: rule.message,
    })),
  );
}

export function readSources(root: string, directories: readonly string[]): Source[] {
  const sources: Source[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$|\.css$/.test(entry.name)) {
        sources.push({
          file: relative(root, path).replaceAll("\\", "/"),
          text: readFileSync(path, "utf8"),
        });
      }
    }
  }
  for (const directory of directories) visit(join(root, directory));
  return sources.sort((first, second) => first.file.localeCompare(second.file));
}

export function sourceDirectories(root: string): string[] {
  return ["apps", "packages"].flatMap((parent) =>
    readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}/src`),
  );
}
