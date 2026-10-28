import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectReadmes } from "./check-references.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const statuses = ["enforced", "partial", "planned"];
const fieldNames = [
  "Status",
  "Wording",
  "Where",
  "Mechanism",
  "Test",
  "Reference",
  "Mutation",
  "Missing",
];
const sourceFile = /\.(ts|tsx|mjs|js|sol|json|sql|md)$/;

// Exact declared names only: a renamed test must not satisfy a register row by substring.
export function declaredTests(contents) {
  const names = new Set();
  const direct = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,/g;
  const each = /\.each\([\s\S]*?\)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,/g;
  for (const pattern of [direct, each]) {
    for (const match of contents.matchAll(pattern)) names.add(match[2]);
  }
  for (const match of contents.matchAll(/\bfunction\s+((?:test|invariant)\w*)\s*\(/g)) {
    names.add(match[1]);
  }
  return names;
}

export function referenceAnchors(document) {
  return new Set([...document.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((match) => match[1]));
}

export function checkTrustClaims(register, { anchors, readmes, readFile }) {
  const errors = [];
  const ids = new Set();
  const sections = register.split(/^### /m).slice(1);
  if (!sections.length) errors.push("No claim entries found");
  for (const section of sections) {
    const [heading] = section.split("\n");
    const id = heading.match(/^([A-Z]+-\d+)\b/)?.[1];
    if (!id) {
      errors.push(`Claim heading has no CLAIM-ID: ${heading}`);
      continue;
    }
    if (ids.has(id)) errors.push(`${id}: duplicate claim`);
    ids.add(id);
    const fields = {};
    for (const name of fieldNames) {
      fields[name] = section.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, "m"))?.[1].trim();
    }
    checkClaim(id, fields, { anchors, readFile, errors });
  }
  for (const [name, contents] of Object.entries(readmes)) {
    for (const match of contents.matchAll(/<!-- claim: ([A-Z]+-\d+) -->/g)) {
      if (!ids.has(match[1]))
        errors.push(`${name}: claim marker ${match[1]} has no register entry`);
    }
  }
  return errors;
}

function checkClaim(id, fields, { anchors, readFile, errors }) {
  const status = fields.Status;
  if (!statuses.includes(status)) {
    errors.push(`${id}: status must be one of ${statuses.join(", ")}, got ${status ?? "nothing"}`);
  }
  if (!fields.Wording) errors.push(`${id}: missing Wording`);

  if (!fields.Where) errors.push(`${id}: missing Where`);
  for (const entry of (fields.Where ?? "").replaceAll("`", "").split(/;\s*/)) {
    const match = entry.match(/^(\S+):(\d+)$/);
    if (!match) {
      errors.push(`${id}: Where entry must be path:line, got ${entry}`);
      continue;
    }
    const contents = readFile(match[1]);
    if (contents === undefined) errors.push(`${id}: Where file does not exist: ${match[1]}`);
    else if (Number(match[2]) > contents.split("\n").length) {
      errors.push(`${id}: Where line past end of file: ${entry}`);
    }
  }

  const tests = [...(fields.Test ?? "").replaceAll("`", "").matchAll(/(\S+) "([^"]+)"/g)];
  if (!fields.Test) errors.push(`${id}: missing Test`);
  else if (fields.Test !== "none" && !tests.length) {
    errors.push(`${id}: Test must be none or path "test name" entries`);
  }
  if (status === "enforced" && !tests.length) errors.push(`${id}: enforced row has no test`);
  for (const [, path, name] of tests) {
    const contents = readFile(path);
    if (contents === undefined) errors.push(`${id}: test file does not exist: ${path}`);
    else if (!declaredTests(contents).has(name))
      errors.push(`${id}: test name not found in ${path}: ${name}`);
  }

  if (!fields.Reference) errors.push(`${id}: missing Reference`);
  else if (fields.Reference !== "none yet (gap)") {
    const cited = [...fields.Reference.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    if (!cited.length) errors.push(`${id}: Reference must name anchors or say none yet (gap)`);
    for (const anchor of cited) {
      if (!anchors.has(anchor)) errors.push(`${id}: unknown reference anchor ${anchor}`);
    }
  }

  if (!fields.Mechanism) errors.push(`${id}: missing Mechanism`);
  const sources = [...(fields.Mechanism ?? "").matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((token) => token.includes("/") && sourceFile.test(token));
  if (status === "enforced" && !sources.length) {
    errors.push(`${id}: enforced mechanism names no source file`);
  }
  for (const path of sources) {
    if (readFile(path) === undefined) errors.push(`${id}: mechanism file does not exist: ${path}`);
  }

  if (["partial", "planned"].includes(status) && !fields.Missing) {
    errors.push(`${id}: ${status} row must say what is missing`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const readFile = (path) => {
    const full = resolve(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  };
  const errors = checkTrustClaims(readFileSync(resolve(root, "docs/TRUST-CLAIMS.md"), "utf8"), {
    anchors: referenceAnchors(readFileSync(resolve(root, "docs/REFERENCES.md"), "utf8")),
    readmes: collectReadmes(root),
    readFile,
  });
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Trust claims register is well formed.");
}
