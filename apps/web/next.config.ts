import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants.js";

export default async function nextConfig(phase: string): Promise<NextConfig> {
  // NEXT_PUBLIC_* values are inlined at build time, so a deploy build (YEN-14) must set them;
  // this check only stops a server from starting with a missing or malformed value.
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    await import("./src/env.ts");
  }
  const buildId =
    process.env.YEN_BUILD_ID ??
    execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
    }).trim();
  return { generateBuildId: async () => buildId };
}
