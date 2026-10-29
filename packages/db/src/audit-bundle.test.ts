import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pseudonymIdSchema } from "@yen/eventlog";
import {
  buildIntervalTree,
  fromHex,
  fundIdSchema,
  hash32,
  orgIdSchema,
  salt32,
  toHex,
} from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { exportAuditBundle } from "./audit-bundle.js";
import { appendEvent } from "./events.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";

const verifier = resolve(
  fileURLToPath(new URL("../../../verifiers/python/yen_verify.py", import.meta.url)),
);

function required<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`missing fixture value at ${index}`);
  return value;
}

function runPython(
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

databaseSuite("Postgres audit bundle export", (admin) => {
  beforeAll(async () => migrate(admin));

  it("exports a persisted fund interval verified by Node and Python, including fake RPC anchoring", async () => {
    const userId = randomUUID();
    const orgId = orgIdSchema.parse(randomUUID());
    const fundId = fundIdSchema.parse(randomUUID());
    const phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    await admin`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Export fixture')`;
    await admin`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Export fixture', 'society', ${userId})`;
    await admin`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Export fixture', '{}')`;
    const actor = pseudonymIdSchema.parse(`psn_${randomUUID()}`);
    const appended: Awaited<ReturnType<typeof appendEvent>>[] = [];
    for (let seq = 1; seq <= 2; seq++) {
      appended.push(
        await appendEvent(admin, {
          fundId,
          type: "fund.created",
          version: 1,
          actor,
          occurredAt: `2026-02-01T00:00:0${seq}.000Z`,
          payload: { org_id: orgId, visibility: "public" },
        }),
      );
    }
    const saltValues = ["33".repeat(32), "44".repeat(32)];
    const tree = await buildIntervalTree([
      {
        fundId,
        latestEventHash: hash32(fromHex(required(appended, 1).hash)),
        events: appended.map((event, index) => ({
          seq: event.seq,
          eventHash: hash32(fromHex(event.hash)),
          salt: salt32(fromHex(required(saltValues, index))),
        })),
      },
    ]);
    const anchorId = randomUUID();
    const contract = `0x${"ab".repeat(20)}`;
    const txHash = `0x${"cd".repeat(32)}`;
    const root = toHex(tree.root);
    await admin`INSERT INTO anchors (id, fund_id, from_seq, to_seq, root, status, tx_hash, chain_id, chain_sequence)
      VALUES (${anchorId}, ${fundId}, 1, 2, ${root}, 'submitted', ${txHash}, 80002, 7)`;
    for (let index = 0; index < appended.length; index++) {
      await admin`INSERT INTO anchor_event_salts (anchor_id, fund_id, seq, salt)
        VALUES (${anchorId}, ${fundId}, ${required(appended, index).seq}, ${required(saltValues, index)})`;
    }
    const bundle = await exportAuditBundle(admin, fundId, anchorId, contract);
    const { verifyBundle, verifyAnchor } = await import("../../verifier/src/verify.ts");
    expect(verifyBundle(bundle).every((check) => check.ok)).toBe(true);

    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id: number;
        method: string;
      };
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: rpc.method === "eth_chainId" ? "0x13882" : root,
        }),
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("fake RPC did not bind TCP");
    const rpcUrl = `http://127.0.0.1:${address.port}`;
    const temp = await mkdtemp(join(tmpdir(), "yen-audit-export-"));
    const file = join(temp, "bundle.json");
    try {
      await writeFile(file, `${JSON.stringify(bundle)}\n`);
      expect((await verifyAnchor(bundle, rpcUrl, contract)).every((check) => check.ok)).toBe(true);
      const py = await runPython([verifier, file, "--rpc", rpcUrl, "--contract", contract]);
      expect(py.status, py.stderr).toBe(0);
      expect(JSON.parse(py.stdout), py.stderr).toEqual({ valid: true, reason_code: null });
    } finally {
      server.close();
      await rm(temp, { recursive: true, force: true });
    }
  });
});
