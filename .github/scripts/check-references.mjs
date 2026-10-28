import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function checkReferences(document, readmes) {
  const errors = [];
  const anchors = new Set();
  const urls = new Set();
  const sections = document.split(/^### /m).slice(1);
  if (!sections.length) errors.push("No reference entries found");
  for (const rawSection of sections) {
    const section = rawSection.split(/^## /m, 1)[0];
    const [title] = section.split("\n");
    if (!title.trim()) errors.push("Reference has an empty title");
    for (const field of ["Source", "URL", "What we use it for", "Where in this repo"]) {
      const match = section.match(new RegExp(`^- \\*\\*${field}:\\*\\* (.+)$`, "m"));
      if (!match?.[1].trim()) errors.push(`${title}: missing ${field}`);
      if (field === "URL" && match) {
        let url;
        try {
          url = new URL(match[1].trim());
        } catch {
          /* reported below */
        }
        if (url?.protocol !== "https:") errors.push(`${title}: URL must be HTTPS`);
        else if (urls.has(url.href)) errors.push(`${title}: duplicate URL ${url.href}`);
        else urls.add(url.href);
      }
    }
  }
  for (const match of document.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)) {
    if (anchors.has(match[1])) errors.push(`Duplicate anchor ${match[1]}`);
    anchors.add(match[1]);
  }
  for (const [name, contents] of Object.entries(readmes)) {
    const links = [
      ...contents.matchAll(/\]\(([^\s)]+REFERENCES\.md)#([^\s)]+)\)/g),
      ...contents.matchAll(
        /^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+REFERENCES\.md)#([^\s>]+)>?(?:\s|$)/gm,
      ),
    ];
    for (const match of links) {
      const target = resolve(root, dirname(name), match[1]);
      if (target !== resolve(root, "docs/REFERENCES.md"))
        errors.push(`${name}: incorrect references path ${match[1]}`);
      if (!anchors.has(match[2])) errors.push(`${name}: unknown reference anchor ${match[2]}`);
    }
  }
  return errors;
}

function collectReadmes(dir, result = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      ![".git", "node_modules", "dist", ".next", ".turbo", "lib", "out", "cache"].includes(
        entry.name,
      )
    )
      collectReadmes(resolve(dir, entry.name), result);
    if (entry.isFile() && entry.name.toLowerCase() === "readme.md") {
      const path = resolve(dir, entry.name);
      result[relative(root, path)] = readFileSync(path, "utf8");
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkReferences(
    readFileSync(resolve(root, "docs/REFERENCES.md"), "utf8"),
    collectReadmes(root),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("References and README links are well formed.");
}
