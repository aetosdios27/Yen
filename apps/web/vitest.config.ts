import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    execArgv: ["--require", path.resolve(import.meta.dirname, "./src/test/polyfill.cjs")],
  },
});
