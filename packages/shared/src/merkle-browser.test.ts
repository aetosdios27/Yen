import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/merkle.json" with { type: "json" };
import { parseEventProof, parseHash32, verifyEventProof } from "./index.js";

const sourceRoot = fileURLToPath(new URL("./", import.meta.url));
const merkleRoot = join(sourceRoot, "merkle");
const sourceFiles = readdirSync(merkleRoot, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(merkleRoot, name));
const require = createRequire(import.meta.url);
const esbuildPath = (() => {
  try {
    return require.resolve("esbuild");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND")
      return undefined;
    throw error;
  }
})();

const runner = `
import { readFileSync } from "node:fs";
import { createContext, SourceTextModule } from "node:vm";
const { modules, entry } = JSON.parse(readFileSync(0, "utf8"));
const context = createContext({ crypto: globalThis.crypto, TextEncoder, Uint8Array });
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (!Object.hasOwn(modules, name)) throw new Error("Unexpected import: " + name);
  const module = new SourceTextModule(modules[name], { context, identifier: name });
  cache.set(name, module);
  return module;
}
const main = new SourceTextModule(entry, { context, identifier: "/entry.js" });
await main.link((specifier, parent) => load(new URL(specifier, "file://" + parent.identifier).pathname));
await main.evaluate();
process.stdout.write(main.namespace.result);
`;

function runInBrowserContext(entry: string, modules: Record<string, string>): string {
  const result = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--input-type=module", "-e", runner],
    {
      input: JSON.stringify({ entry, modules }),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("browser portability", () => {
  it("every src/merkle TypeScript file avoids Node imports, Buffer and process", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bnode:|\bBuffer\b|\bprocess\b/);
    }
  });

  it(
    esbuildPath === undefined
      ? "runs the same nested verifier in Node and a restricted VM (esbuild unavailable)"
      : "bundles for platform=browser and runs the same nested verifier in Node and the browser bundle",
    async () => {
      const cases = vectors.intervals.flatMap((interval) =>
        interval.proofs.map((proof) => ({ proof, root: interval.root })),
      );
      const nodeResults: boolean[] = [];
      for (const entry of cases) {
        const proof = parseEventProof(entry.proof);
        const root = parseHash32(entry.root);
        if (!proof.ok || !root.ok) throw new Error("Valid fixture proof and root");
        nodeResults.push(await verifyEventProof(proof.value, root.value));
        proof.value.eventHash[0] = (proof.value.eventHash[0] ?? 0) ^ 1;
        nodeResults.push(await verifyEventProof(proof.value, root.value));
      }
      const entrySource = `
      import { parseEventProof, parseHash32, verifyEventProof } from "/index.js";
      if (typeof process !== "undefined" || typeof Buffer !== "undefined" || typeof require !== "undefined") throw new Error("Node global leaked");
      const results = [];
      for (const entry of ${JSON.stringify(cases)}) {
        const proof = parseEventProof(entry.proof);
        const root = parseHash32(entry.root);
        if (!proof.ok || !root.ok) throw new Error("Invalid fixture");
        results.push(await verifyEventProof(proof.value, root.value));
        proof.value.eventHash[0] ^= 1;
        results.push(await verifyEventProof(proof.value, root.value));
      }
      export const result = JSON.stringify(results);
    `;
      let modules: Record<string, string> = {};
      if (esbuildPath === undefined) {
        const temporary = mkdtempSync(join(tmpdir(), "yen27-vm-"));
        try {
          const result = spawnSync(
            "pnpm",
            [
              "exec",
              "tsc",
              "-p",
              fileURLToPath(new URL("../tsconfig.build.json", import.meta.url)),
              "--outDir",
              temporary,
            ],
            { encoding: "utf8", timeout: 15_000 },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, result.stdout + result.stderr).toBe(0);
          for (const name of readdirSync(temporary, { recursive: true, encoding: "utf8" }).filter(
            (file) => file.endsWith(".js"),
          )) {
            modules[`/${name}`] = readFileSync(join(temporary, name), "utf8");
          }
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      } else {
        const temporary = mkdtempSync(join(tmpdir(), "yen27-browser-"));
        try {
          const bundle = join(temporary, "bundle.js");
          const result = spawnSync(
            join(dirname(esbuildPath), "../bin/esbuild"),
            [
              join(sourceRoot, "index.ts"),
              "--bundle",
              "--platform=browser",
              "--format=esm",
              `--outfile=${bundle}`,
            ],
            { encoding: "utf8", timeout: 15_000 },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
          modules = { "/index.js": readFileSync(bundle, "utf8") };
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      }
      expect(runInBrowserContext(entrySource, modules)).toBe(JSON.stringify(nodeResults));
      expect(nodeResults).toEqual(cases.flatMap(() => [true, false]));
    },
  );
});
