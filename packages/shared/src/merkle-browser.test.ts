import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/merkle.json" with { type: "json" };
import { parseEventProof, parseHash32, verifyEventProof } from "./index.js";

const sourceRoot = fileURLToPath(new URL("./", import.meta.url));
const merkleRoot = join(sourceRoot, "merkle");
const sourceFiles = readdirSync(merkleRoot, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(merkleRoot, name));
const runner = `
import { readFileSync } from "node:fs";
import { createContext, SourceTextModule } from "node:vm";
const { bundle, entry } = JSON.parse(readFileSync(0, "utf8"));
const context = createContext({ crypto: globalThis.crypto, TextEncoder, Uint8Array });
const main = new SourceTextModule(entry, { context });
await main.link((specifier) => {
  if (specifier !== "/index.js") throw new Error("Unexpected import: " + specifier);
  return new SourceTextModule(bundle, { context });
});
await main.evaluate();
process.stdout.write(main.namespace.result);
`;

function runInBrowserContext(entry: string, bundle: string): string {
  const result = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--input-type=module", "-e", runner],
    {
      input: JSON.stringify({ entry, bundle }),
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

  it("bundles for platform=browser and runs the same nested verifier in Node and the browser bundle", async () => {
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
      proof.value.eventHash[0] = (proof.value.eventHash[0] ?? 0) ^ 1;
      for (const key of ["eventProof", "fundProof"] as const) {
        nodeResults.push(
          await verifyEventProof(
            { ...proof.value, [key]: { ...proof.value[key], size: proof.value[key].size ^ 2 } },
            root.value,
          ),
        );
      }
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
        proof.value.eventHash[0] ^= 1;
        for (const key of ["eventProof", "fundProof"]) {
          results.push(await verifyEventProof({
            ...proof.value, [key]: { ...proof.value[key], size: proof.value[key].size ^ 2 },
          }, root.value));
        }
      }
      export const result = JSON.stringify(results);
    `;
    const output = await build({
      entryPoints: [join(sourceRoot, "index.ts")],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      plugins: [
        {
          name: "reject-node-imports",
          setup(build) {
            build.onResolve({ filter: /^node:/ }, ({ path }) => ({
              errors: [{ text: `Node import is forbidden in the browser bundle: ${path}` }],
            }));
          },
        },
      ],
    });
    const bundle = output.outputFiles[0];
    if (bundle === undefined) throw new Error("Expected a browser bundle");
    expect(runInBrowserContext(entrySource, bundle.text)).toBe(JSON.stringify(nodeResults));
    expect(nodeResults).toEqual(cases.flatMap(() => [true, false, false, false]));
  });
});
