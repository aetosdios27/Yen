import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareBaseline, countViolations, lowerBaseline } from "./check-baseline.js";
import { checkCode } from "./code-rules.js";
import { checkDesign } from "./design-rules.js";
import { runSourceCheck } from "./run-source-check.js";
import { readSources } from "./source-check.js";

const webFile = "apps/web/src/components/example.tsx";
const design = (text: string) => checkDesign({ file: webFile, text }).map((item) => item.rule);
const code = (text: string, file = webFile) => checkCode({ file, text }).map((item) => item.rule);

describe("design rules", () => {
  it.each([
    "#abc",
    "#abcd",
    "#abcdef",
    "#abcdef12",
    "rgb(0 0 0)",
    "rgba(0,0,0,1)",
    "hsl(0 0% 0%)",
    "hsla(0,0%,0%,1)",
    "oklch(0 0 0)",
  ])("catches colour %s", (value) => {
    expect(design(`const colour = "${value}"`)).toContain("colour-literal");
  });
  it.each([
    "bg-green-600",
    "hover:text-gray-500",
    "border-zinc-200",
    "stroke-red-800",
    "from-blue-300",
  ])("catches palette %s", (value) => {
    expect(design(`const classes = "${value}"`)).toContain("palette-class");
  });
  it.each([
    "p-[13px]",
    "mt-[7px]",
    "focus-visible:ring-[3px]",
    "grid-cols-[1fr_auto]",
    "w-[calc(100%-2rem)]",
  ])("catches arbitrary %s", (value) => {
    expect(design(`const classes = "${value}"`)).toContain("arbitrary-value");
  });
  it("allows Radix variable measurements and state selectors", () => {
    expect(
      design('const classes = "min-w-[var(--radix-trigger-width)] data-[state=open]:bg-surface"'),
    ).toEqual([]);
  });
  it("catches arbitrary properties, inline styles, important and text opacity", () => {
    expect(
      design(
        'const classes = "[overflow-wrap:anywhere] text-ink/60"; <p style={{}} />; .x { color: red !important }',
      ),
    ).toEqual(["arbitrary-property", "inline-style", "important", "text-opacity"]);
  });
  it("leaves direction-dependent rules disabled and ignores comments", () => {
    expect(
      design('const classes = "dark:bg-canvas font-bold shadow-lg"; // #ffffff\n/* rgb(0 0 0) */'),
    ).toEqual([]);
  });
  it("exempts tokens and tests", () => {
    for (const file of [
      "apps/web/src/styles/tokens.css",
      "apps/web/src/components/example.test.tsx",
    ]) {
      expect(checkDesign({ file, text: 'const colour = "#fff"' })).toEqual([]);
    }
  });
  it.each([
    "hash",
    "block",
    "Merkle",
    "on-chain",
    "anchor",
    "anchored",
    "anchoring",
    "successfully",
    "Welcome back",
    "Oops",
    "Done!",
  ])("catches message %s", (word) => {
    expect(
      checkDesign({
        file: "apps/web/src/i18n/messages/en.ts",
        text: `export const en = { visible: "${word}" }`,
      }).map((item) => item.rule),
    ).toContain("interface-word");
  });
  it("allows only the explicit technical-detail message keys", () => {
    const file = "apps/web/src/i18n/messages/en.ts";
    expect(
      checkDesign({
        file,
        text: 'export const en = { verify: { canonicalHashLabel: "Hash", visible: "Hash" } }',
      }).map((item) => item.rule),
    ).toEqual(["interface-word"]);
  });
  it("reports the actual source line", () => {
    expect(
      checkDesign({ file: webFile, text: '// #fff\n\nconst classes = "text-red-500";' }),
    ).toMatchObject([{ line: 3, rule: "palette-class" }]);
  });
});

describe("code rules", () => {
  it("checks file limits and counts excess lines so existing files cannot grow", () => {
    const text = Array.from({ length: 202 }, () => "const example = 1;").join("\n");
    expect(checkCode({ file: webFile, text })).toMatchObject([
      { rule: "file-size", line: 201, count: 2 },
    ]);
    expect(code(text, "apps/web/src/example.ts")).toEqual([]);
    expect(code(text, webFile.replace(".tsx", ".test.tsx"))).toEqual([]);
    expect(
      code(Array.from({ length: 301 }, () => "x").join("\n"), "packages/shared/src/example.ts"),
    ).toContain("file-size");
  });
  it("catches default exports except Next entry points", () => {
    expect(code("export default function Example() {};")).toContain("default-export");
    expect(code("export { Example as default };")).toContain("default-export");
    expect(
      code("export default function Page() {};", "apps/web/src/app/funds/[id]/page.tsx"),
    ).toEqual([]);
    expect(code("export default function Page() {};", "packages/shared/src/page.ts")).toContain(
      "default-export",
    );
    expect(code("// export default example\nconst example = 1;")).toEqual([]);
  });
  it("rejects app barrels but permits modules and package entry points", () => {
    expect(code('export {Example} from "./example";', "apps/web/src/index.ts")).toContain(
      "barrel-index",
    );
    expect(code('export {Example} from "./example";', "packages/shared/src/index.ts")).toEqual([]);
    expect(code("export const example = 1;", "apps/web/src/index.ts")).toEqual([]);
  });
  it("requires TODO issue references and disallows production type suppressions", () => {
    expect(code("// TODO fix this")).toContain("untracked-todo");
    expect(code("// TODO YEN-99 fix this")).toEqual([]);
    expect(code("// @ts-ignore\nconst value = 1;")).toContain("ts-suppression");
    expect(code("// @ts-expect-error\nconst value = 1;")).toContain("ts-suppression");
    expect(
      code("// @ts-expect-error\nconst value = 1;", webFile.replace(".tsx", ".test.tsx")),
    ).toEqual([]);
  });
  it("rejects handwritten web fetches outside the wrapper", () => {
    expect(code('fetch("/v1/funds")')).toContain("api-fetch");
    expect(code("fetch(url)", "apps/web/src/lib/api-client.ts")).toEqual([]);
    expect(code("fetch(url)", "apps/api/src/example.ts")).toEqual([]);
  });
});

describe("shrinking baselines", () => {
  const baseline = [{ file: webFile, rule: "palette-class", count: 3 }];
  it("rejects increases and new file/rule combinations", () => {
    for (const current of [
      [{ ...baseline[0], file: webFile, rule: "palette-class", count: 4 }],
      [{ file: "new.ts", rule: "palette-class", count: 1 }],
      [{ file: webFile, rule: "new-rule", count: 1 }],
    ]) {
      expect(compareBaseline(baseline, current).increases).toHaveLength(1);
      expect(
        lowerBaseline(baseline, current).every(
          (entry) => entry.count <= 3 && entry.file === webFile && entry.rule === "palette-class",
        ),
      ).toBe(true);
    }
  });
  it("requires and permits reductions and removals", () => {
    const current = [{ file: webFile, rule: "palette-class", count: 1 }];
    expect(compareBaseline(baseline, current).decreases).toEqual(baseline);
    expect(lowerBaseline(baseline, current)).toEqual(current);
    expect(lowerBaseline(baseline, [])).toEqual([]);
  });
  it("counts repeated findings per file and rule", () => {
    expect(
      countViolations(
        checkDesign({ file: webFile, text: 'const classes = "text-red-500 bg-blue-600";' }),
      ),
    ).toEqual([{ file: webFile, rule: "palette-class", count: 2 }]);
  });
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("runs against real files and update cannot bless a regression", () => {
  const root = mkdtempSync(join(tmpdir(), "yen-check-"));
  directories.push(root);
  mkdirSync(join(root, "scripts/baselines"), { recursive: true });
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  const path = join(root, "scripts/baselines/design.json");
  const file = "apps/web/src/example.ts";
  writeFileSync(path, JSON.stringify([{ file, rule: "palette-class", count: 2 }]));
  writeFileSync(join(root, file), 'const classes="text-red-500";');
  const run = (update: boolean) =>
    runSourceCheck({
      name: "design",
      root,
      sources: readSources(root, ["apps/web/src"]),
      check: checkDesign,
      update,
    });
  expect(run(false)).toBe(1);
  expect(run(true)).toBe(0);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([
    { file, rule: "palette-class", count: 1 },
  ]);
  writeFileSync(join(root, file), 'const classes="text-red-500 bg-blue-600";');
  expect(run(true)).toBe(1);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([
    { file, rule: "palette-class", count: 1 },
  ]);
  writeFileSync(join(root, file), 'const classes="text-ink";');
  expect(run(false)).toBe(1);
  expect(run(true)).toBe(0);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);
});
