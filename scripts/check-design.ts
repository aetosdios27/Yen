import { checkDesign } from "./design-rules.js";
import { runSourceCheck } from "./run-source-check.js";
import { readSources } from "./source-check.js";

const root = process.cwd();
process.exitCode = runSourceCheck({
  name: "design",
  root,
  sources: readSources(root, ["apps/web/src"]),
  check: checkDesign,
  update: process.argv.includes("--update"),
});
