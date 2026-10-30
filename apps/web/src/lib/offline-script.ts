import type { AuditBundle } from "@yen/shared";

/**
 * Generates a standalone, self-contained ESM script (verify-bundle.mjs)
 * that verifies an audit bundle without external dependencies, using node:crypto.
 */
export function generateOfflineVerifierScript(embeddedBundle?: AuditBundle): string {
  const bundleJson = embeddedBundle ? JSON.stringify(embeddedBundle, null, 2) : "null";

  return `#!/usr/bin/env node
/**
 * Standalone Offline Audit Bundle Verifier
 * 
 * Verifies Yen audit bundle cryptographic proofs independently without network access.
 * Zero npm dependencies (uses standard node:crypto).
 *
 * Usage:
 *   node verify-bundle.mjs [path-to-bundle.json]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EMBEDDED_BUNDLE = ${bundleJson};

function sha256(...chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      hash.update(Buffer.from(chunk, "hex"));
    } else {
      hash.update(chunk);
    }
  }
  return hash.digest();
}

function u64be(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n), 0);
  return b;
}

const EVENT_DOMAIN = Buffer.from("yen/eventlog/event/v1\\0", "utf8");

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function computeCanonicalEventHash(event) {
  const unsigned = {};
  for (const [key, value] of Object.entries(event)) {
    if (key !== "hash") {
      unsigned[key] = value;
    }
  }
  const json = canonicalize(unsigned);
  const hash = createHash("sha256");
  hash.update(EVENT_DOMAIN);
  hash.update(Buffer.from(json, "utf8"));
  return hash.digest("hex");
}

function nodeHash(left, right) {
  return sha256(Buffer.from([1]), left, right);
}

function rootFromInclusion(proof, leaf) {
  const { index, size, path } = proof;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size) {
    return null;
  }
  let fn = index;
  let sn = size - 1;
  let root = leaf;
  for (const siblingHex of path) {
    const sibling = Buffer.from(siblingHex, "hex");
    if (sn === 0) return null;
    if (fn % 2 === 1 || fn === sn) {
      root = nodeHash(sibling, root);
      while (fn % 2 === 0 && fn !== 0) {
        fn /= 2;
        sn = Math.floor(sn / 2);
      }
    } else {
      root = nodeHash(root, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 ? root : null;
}

function verifyBundle(bundle) {
  console.log("=================================================");
  console.log("       Yen Offline Audit Bundle Verifier         ");
  console.log("=================================================");
  console.log(\`Fund ID:       \${bundle.fund_id}\`);
  console.log(\`Event count:   \${bundle.events.length}\`);
  console.log(\`Root anchor:   \${bundle.anchor.root}\`);
  console.log(\`Anchor seq:    \${bundle.anchor.sequence}\`);
  console.log(\`Registry:      \${bundle.anchor.contract_address} (chain \${bundle.anchor.chain_id})\`);
  console.log("-------------------------------------------------");

  let allPassed = true;
  const expectedGlobalRoot = Buffer.from(bundle.anchor.root, "hex");

  for (let i = 0; i < bundle.events.length; i++) {
    const entry = bundle.events[i];
    const { event, salt, latest_event_hash, eventProof, fundProof } = entry;

    // 1. Verify event hash
    const computedHash = computeCanonicalEventHash(event);
    if (computedHash !== event.hash) {
      console.error(\`[FAIL] Event #\${event.seq} hash mismatch:\`);
      console.error(\`       Expected: \${event.hash}\`);
      console.error(\`       Computed: \${computedHash}\`);
      allPassed = false;
      continue;
    }

    // 2. Leaf hash = sha256(0x00, salt, eventHash)
    const saltBuf = Buffer.from(salt, "hex");
    const eventHashBuf = Buffer.from(event.hash, "hex");
    const leaf = sha256(Buffer.from([0]), saltBuf, eventHashBuf);

    // 3. Merkle path to event root
    const eventRoot = rootFromInclusion(eventProof, leaf);

    // 4. Fund fingerprint = sha256(0x03, fundIdBytes, latestEventHash)
    const fundIdBytes = Buffer.from(bundle.fund_id.replaceAll("-", ""), "hex");
    const latestEventHashBuf = Buffer.from(latest_event_hash, "hex");
    const identity = sha256(Buffer.from([3]), fundIdBytes, latestEventHashBuf);

    // 5. Fund leaf = sha256(0x02, u64be(size), eventRoot, identity)
    const fLeaf = sha256(Buffer.from([2]), u64be(eventProof.size), eventRoot, identity);

    // 6. Merkle path to interval root
    const intervalRoot = rootFromInclusion(fundProof, fLeaf);

    // 7. Global root = sha256(0x04, u64be(fundSize), intervalRoot)
    const globalRoot = sha256(Buffer.from([4]), u64be(fundProof.size), intervalRoot);

    if (!globalRoot.equals(expectedGlobalRoot)) {
      console.error(\`[FAIL] Event #\${event.seq} Merkle proof does not match anchor root\`);
      allPassed = false;
    } else {
      console.log(\`[OK]   Event #\${event.seq} [\${event.type}] sealed and verified\`);
    }
  }

  console.log("-------------------------------------------------");
  if (allPassed) {
    console.log("RESULT: ALL CRYPTOGRAPHIC CHECKS PASSED (VERIFIED)");
    process.exit(0);
  } else {
    console.error("RESULT: VERIFICATION FAILED - TAMPERING OR CORRUPTION DETECTED");
    process.exit(1);
  }
}

function main() {
  const filePath = process.argv[2];
  let bundle = EMBEDDED_BUNDLE;
  if (filePath) {
    try {
      const data = readFileSync(filePath, "utf8");
      bundle = JSON.parse(data);
    } catch (err) {
      console.error(\`Failed to read bundle from \${filePath}: \${err.message}\`);
      process.exit(1);
    }
  }
  if (!bundle) {
    console.error("No audit bundle provided. Pass file path: node verify-bundle.mjs bundle.json");
    process.exit(1);
  }
  verifyBundle(bundle);
}

main();
`;
}

/**
 * Triggers a client-side browser file download.
 */
export function triggerDownload(filename: string, content: string, mimeType: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
