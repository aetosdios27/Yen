import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: resolve(process.cwd(), "node_modules/.vitest-cache"),
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
