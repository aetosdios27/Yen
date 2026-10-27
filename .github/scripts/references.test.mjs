import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { checkReferences } from "./check-references.mjs";

const entry = `<a id="example"></a>
### Example

- **Source:** Author; Publisher, 2020.
- **URL:** https://example.org/paper
- **What we use it for:** A reason.
- **Where in this repo:** YEN-1
`;

test("repository bibliography and README links pass the guard", () => {
  execFileSync(process.execPath, [".github/scripts/check-references.mjs"], { stdio: "pipe" });
});

test("rejects missing fields, non-HTTPS and duplicate URLs", () => {
  assert.deepEqual(checkReferences(entry, {}), []);
  assert.match(
    checkReferences(entry.replace("A reason.", ""), {}).join(),
    /missing What we use it for/,
  );
  assert.match(checkReferences(entry.replace("https:", "http:"), {}).join(), /HTTPS/);
  assert.match(checkReferences(`${entry}\n${entry}`, {}).join(), /duplicate URL/);
  assert.match(checkReferences(entry.replace("### Example", "### "), {}).join(), /empty title/);
});

test("rejects broken README targets and unknown anchors", () => {
  assert.match(
    checkReferences(entry, {
      "packages/db/README.md": "[x](../../docs/REFERENCES.md#missing)",
    }).join(),
    /unknown reference anchor/,
  );
  assert.match(
    checkReferences(entry, {
      "packages/db/README.md": "[x](../docs/REFERENCES.md#example)",
    }).join(),
    /incorrect references path/,
  );
});

test("does not take missing fields from a later area", () => {
  const missing = entry.replace("- **Where in this repo:** YEN-1", "");
  assert.match(
    checkReferences(`${missing}\n## Other area\n- **Where in this repo:** misplaced`, {}).join(),
    /missing Where in this repo/,
  );
});
