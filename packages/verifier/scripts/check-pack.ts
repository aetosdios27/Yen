import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = await mkdtemp(join(tmpdir(), "yen-verifier-pack-"));
try {
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", destination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const [{ filename }] = JSON.parse(packed.stdout) as { filename: string }[];
  const manifest = spawnSync("tar", ["-xOf", join(destination, filename), "package/package.json"], {
    encoding: "utf8",
  });
  if (manifest.status !== 0) throw new Error(`could not read packed manifest: ${manifest.stderr}`);
  const pkg = JSON.parse(manifest.stdout) as {
    bin?: Record<string, string>;
    exports?: Record<string, { import?: string; types?: string }>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencyVersions = Object.values({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  });
  if (dependencyVersions.some((version) => version.startsWith("workspace:")))
    throw new Error("packed manifest contains a workspace: dependency");
  if (!pkg.bin?.["yen-verify"] || !pkg.exports?.["."]?.import || !pkg.exports["."]?.types)
    throw new Error("packed manifest is missing CLI or library exports");
  console.log(
    `npm pack produced ${filename} with CLI/library exports and no workspace dependencies.`,
  );
} finally {
  await rm(destination, { recursive: true, force: true });
}
