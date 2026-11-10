import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["sandbox/**/*.sandbox.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
    retry: 0,
  },
});
