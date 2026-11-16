import { checkCode } from "./code-rules.js";
import { runSourceCheck } from "./run-source-check.js";
import { readSources, sourceDirectories } from "./source-check.js";

const root = process.cwd();
process.exitCode = runSourceCheck({
  name: "code",
  root,
  sources: readSources(root, sourceDirectories(root)),
  check: checkCode,
  update: process.argv.includes("--update"),
});
