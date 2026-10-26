import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants.js";

export default async function nextConfig(phase: string): Promise<NextConfig> {
  // Runtime config must fail before serving; build and typegen need no env.
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    await import("./src/env.ts");
  }
  return {};
}
