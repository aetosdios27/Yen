import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const contracts = fileURLToPath(new URL("../", import.meta.url));
const script = resolve(contracts, "script/write-manifest.mjs");
const artifact = JSON.parse(
  readFileSync(resolve(contracts, "out/RootRegistry.sol/RootRegistry.json"), "utf8"),
);
const address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const publisher = "0x000000000000000000000000000000000000bEEF";
const hash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;
const broadcast = {
  chain: 80002,
  transactions: [
    {
      transactionType: "CREATE",
      contractName: "RootRegistry",
      hash,
      contractAddress: address,
    },
  ],
};
let server;
let rpcUrl;
let override = () => undefined;

function rpcResult(method, params) {
  if (method === "eth_chainId") return "0x13882";
  if (method === "eth_getTransactionReceipt") {
    return {
      status: "0x1",
      transactionHash: hash,
      contractAddress: address,
      blockNumber: "0x1",
      blockHash,
    };
  }
  if (method === "eth_getBlockByNumber") return { hash: blockHash };
  if (method === "eth_getTransactionByHash") {
    return {
      to: null,
      input: `${artifact.bytecode.object}${publisher.slice(2).padStart(64, "0")}`,
    };
  }
  if (method === "eth_getCode") return artifact.deployedBytecode.object;
  if (method === "eth_call") {
    return params[0].data === `0x${artifact.methodIdentifiers["publisher()"]}`
      ? `0x${publisher.slice(2).padStart(64, "0")}`
      : `0x${"0".repeat(64)}`;
  }
  throw new Error(`Unexpected RPC method ${method}`);
}

before(async () => {
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { method, params } = JSON.parse(body);
    const envelope = { jsonrpc: "2.0", id: 1, result: rpcResult(method, params) };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(override(method, envelope) ?? envelope));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  rpcUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

async function runWriter({ data = broadcast, env = {}, changeRpc = () => undefined } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "yen-manifest-"));
  const broadcastPath = join(directory, "broadcast.json");
  const outputPath = join(directory, "manifest.json");
  writeFileSync(broadcastPath, typeof data === "string" ? data : JSON.stringify(data));
  override = changeRpc;
  const childEnv = {
    ...process.env,
    AMOY_RPC_URL: rpcUrl,
    ROOT_REGISTRY_PUBLISHER: publisher,
    ...env,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  try {
    const result = await new Promise((resolveExit) => {
      const child = spawn(process.execPath, [script, broadcastPath, outputPath], { env: childEnv });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => resolveExit({ code, stdout, stderr }));
    });
    return { ...result, output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
    override = () => undefined;
  }
}

function expectFailure(result, path) {
  assert.notEqual(result.code, 0);
  assert.equal(result.output, null);
  assert.match(result.stderr, path);
  assert.doesNotMatch(result.stderr, /TypeError|SyntaxError|\bat .*\.mjs:\d+/);
  assert.equal(result.stderr.trim().split(/\r?\n/).length, 1);
}

test("valid deployment writes the expected manifest", async () => {
  const result = await runWriter();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.output), {
    $schema: "./amoy.schema.json",
    status: "deployed",
    chainId: 80002,
    address,
    transactionHash: hash,
    blockNumber: 1,
    compilerVersion: artifact.metadata.compiler.version,
    publisher,
  });
  assert.equal(result.output, `${JSON.stringify(JSON.parse(result.output), null, 2)}\n`);
});

for (const [name, options, path] of [
  ["missing RPC URL", { env: { AMOY_RPC_URL: undefined } }, /env\.AMOY_RPC_URL:/],
  ["invalid RPC URL", { env: { AMOY_RPC_URL: "ftp://localhost" } }, /env\.AMOY_RPC_URL:/],
  [
    "missing publisher",
    { env: { ROOT_REGISTRY_PUBLISHER: undefined } },
    /env\.ROOT_REGISTRY_PUBLISHER:/,
  ],
  [
    "zero publisher",
    { env: { ROOT_REGISTRY_PUBLISHER: `0x${"0".repeat(40)}` } },
    /env\.ROOT_REGISTRY_PUBLISHER:/,
  ],
  ["malformed broadcast JSON", { data: "{" }, /broadcast: invalid JSON/],
  [
    "truncated broadcast JSON",
    { data: '{"chain":80002,"transactions":[' },
    /broadcast: invalid JSON/,
  ],
  ["missing broadcast transactions", { data: { chain: 80002 } }, /broadcast\.transactions:/],
  [
    "missing broadcast transaction hash",
    { data: { ...broadcast, transactions: [{ ...broadcast.transactions[0], hash: undefined }] } },
    /broadcast\.transactions\[0\]\.hash:/,
  ],
  [
    "wrong broadcast chain",
    { data: { ...broadcast, chain: 31337 } },
    /broadcast\.chain: must be 80002/,
  ],
  [
    "empty transactions",
    { data: { ...broadcast, transactions: [] } },
    /broadcast\.transactions: expected one deployment transaction/,
  ],
  [
    "missing JSON-RPC envelope id",
    {
      changeRpc: (method, envelope) =>
        method === "eth_chainId" ? { jsonrpc: "2.0", result: envelope.result } : undefined,
    },
    /RPC eth_chainId\.id:/,
  ],
  [
    "missing chain ID result",
    { changeRpc: (method) => (method === "eth_chainId" ? { jsonrpc: "2.0", id: 1 } : undefined) },
    /RPC eth_chainId\.result:/,
  ],
  [
    "wrong RPC chain",
    {
      changeRpc: (method, envelope) =>
        method === "eth_chainId" ? { ...envelope, result: "0x7a69" } : undefined,
    },
    /RPC eth_chainId: must be 80002/,
  ],
  [
    "missing receipt status",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getTransactionReceipt"
          ? { ...envelope, result: { ...envelope.result, status: undefined } }
          : undefined,
    },
    /RPC eth_getTransactionReceipt\.result\.status:/,
  ],
  [
    "receipt with non-hex address",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getTransactionReceipt"
          ? { ...envelope, result: { ...envelope.result, contractAddress: "not-an-address" } }
          : undefined,
    },
    /RPC eth_getTransactionReceipt\.result\.contractAddress:/,
  ],
  [
    "wrong contract address",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getTransactionReceipt"
          ? { ...envelope, result: { ...envelope.result, contractAddress: `0x${"3".repeat(40)}` } }
          : undefined,
    },
    /RPC eth_getTransactionReceipt\.result\.contractAddress: differs from broadcast/,
  ],
  [
    "missing block hash",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getBlockByNumber" ? { ...envelope, result: {} } : undefined,
    },
    /RPC eth_getBlockByNumber\.result\.hash:/,
  ],
  [
    "missing creation input",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getTransactionByHash" ? { ...envelope, result: { to: null } } : undefined,
    },
    /RPC eth_getTransactionByHash\.result\.input:/,
  ],
  [
    "bytecode mismatch",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getTransactionByHash"
          ? { ...envelope, result: { ...envelope.result, input: "0x1234" } }
          : undefined,
    },
    /Creation bytecode or constructor publisher differs from the build/,
  ],
  [
    "missing deployed code result",
    { changeRpc: (method) => (method === "eth_getCode" ? { jsonrpc: "2.0", id: 1 } : undefined) },
    /RPC eth_getCode\.result:/,
  ],
  [
    "deployed bytecode mismatch",
    {
      changeRpc: (method, envelope) =>
        method === "eth_getCode" ? { ...envelope, result: "0x1234" } : undefined,
    },
    /Deployed bytecode differs from the build/,
  ],
  [
    "missing call result",
    { changeRpc: (method) => (method === "eth_call" ? { jsonrpc: "2.0", id: 1 } : undefined) },
    /RPC eth_call\.result:/,
  ],
  [
    "RPC error",
    {
      changeRpc: (method) =>
        method === "eth_getTransactionReceipt"
          ? { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "missing\nreceipt" } }
          : undefined,
    },
    /RPC eth_getTransactionReceipt\.error: -32000 missing receipt/,
  ],
  [
    "malformed RPC error",
    {
      changeRpc: (method) =>
        method === "eth_getTransactionReceipt"
          ? { jsonrpc: "2.0", id: 1, error: { code: -32000 } }
          : undefined,
    },
    /RPC eth_getTransactionReceipt\.error\.message:/,
  ],
]) {
  test(name, async () => {
    expectFailure(await runWriter(options), path);
  });
}
