#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyAnchor, verifyBundle } from "./verify.js";

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith("--"));
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
if (!path) {
  console.error("Usage: yen-verify bundle.json [--rpc URL --contract ADDRESS]");
  process.exit(2);
}
try {
  const bundle = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof verifyBundle>[0];
  const checks = verifyBundle(bundle);
  const rpcUrl = option("--rpc");
  if (rpcUrl) {
    const contract = option("--contract");
    if (!contract) throw new Error("--contract is required with --rpc");
    checks.push(...(await verifyAnchor(bundle, rpcUrl, contract)));
  }
  for (const check of checks)
    console.log(
      `${check.ok ? "PASS" : "FAIL"} ${check.name}${check.position === undefined ? "" : ` at event ${check.position}`} ${check.detail ?? ""}`,
    );
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
} catch (error) {
  console.error(`FAIL bundle: ${String(error)}`);
  process.exitCode = 1;
}
