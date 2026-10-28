import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// Runs the compiled output with plain Node, outside Vitest, so the JSON import has to resolve
// against dist/ exactly as it does in production.
it("evaluates exit criteria from the built dist output under plain Node", async () => {
  const distEvaluator = pathToFileURL(
    fileURLToPath(new URL("../dist/evaluator.js", import.meta.url)),
  );
  const script = `
    import { evaluateExitCriteria } from ${JSON.stringify(distEvaluator.href)};
    const result = evaluateExitCriteria({
      queueName: "notifications",
      queueDepth: 12000,
      queueDepthSustainedSeconds: 1000,
      p99LatencyMs: 1,
    });
    process.stdout.write(JSON.stringify(result));
  `;

  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script]);

  expect(JSON.parse(stdout)).toEqual({
    exceeded: true,
    reasons: [
      "Queue depth 12000 exceeds maximum threshold 10000 for sustained 1000s (limit: 900s).",
    ],
    recommendedEngine: "BullMQ",
    currentEngine: "pg-boss",
  });
});
