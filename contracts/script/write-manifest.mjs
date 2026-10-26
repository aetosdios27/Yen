import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run after forge script --broadcast. Never infer a deployment from a simulation.
const [broadcastPath, outputPath, ...extra] = process.argv.slice(2);
assert(
  broadcastPath && outputPath && extra.length === 0,
  "Usage: node contracts/script/write-manifest.mjs <broadcast.json> <manifest.json>",
);
const contracts = fileURLToPath(new URL("../", import.meta.url));
// biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone deployment command, never a Turbo task.
const rpcUrl = process.env.AMOY_RPC_URL;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone deployment command, never a Turbo task.
const publisher = process.env.ROOT_REGISTRY_PUBLISHER;
assert(rpcUrl, "AMOY_RPC_URL is required");
assert(
  /^0x[0-9a-fA-F]{40}$/.test(publisher ?? "") && BigInt(publisher) !== 0n,
  "ROOT_REGISTRY_PUBLISHER must be a nonzero address",
);
const artifact = JSON.parse(
  readFileSync(resolve(contracts, "out/RootRegistry.sol/RootRegistry.json"), "utf8"),
);
const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));
assert.equal(broadcast.chain, 80002, "Broadcast must be on chain 80002");
assert.equal(broadcast.transactions.length, 1, "Expected one deployment transaction");
const transaction = broadcast.transactions[0];
assert.equal(transaction.transactionType, "CREATE");
assert.equal(transaction.contractName, "RootRegistry");
assert(/^0x[0-9a-fA-F]{64}$/.test(transaction.hash), "Missing broadcast transaction hash");

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `RPC HTTP status ${response.status}`);
  const result = await response.json();
  assert(!result.error, `RPC ${method}: ${JSON.stringify(result.error)}`);
  assert(result.result !== undefined && result.result !== null, `Missing RPC ${method} result`);
  return result.result;
}

assert.equal(BigInt(await rpc("eth_chainId")), 80002n, "RPC must be on chain 80002");
const receipt = await rpc("eth_getTransactionReceipt", [transaction.hash]);
assert.equal(receipt.status, "0x1", "Deployment transaction did not succeed");
assert.equal(receipt.transactionHash.toLowerCase(), transaction.hash.toLowerCase());
const address = receipt.contractAddress;
assert(
  /^0x[0-9a-fA-F]{40}$/.test(address ?? "") && BigInt(address) !== 0n,
  "Receipt must contain a nonzero contract address",
);
assert.equal(address.toLowerCase(), transaction.contractAddress.toLowerCase());
const blockNumber = Number(BigInt(receipt.blockNumber));
assert(Number.isSafeInteger(blockNumber) && blockNumber > 0, "Invalid receipt block number");
const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
assert.equal(block.hash, receipt.blockHash, "Receipt is no longer in the canonical chain");
assert.equal(artifact.metadata.compiler.version, "0.8.30+commit.73712a01");
const chainTransaction = await rpc("eth_getTransactionByHash", [transaction.hash]);
assert.equal(chainTransaction.to, null, "Expected contract creation");
assert.equal(
  chainTransaction.input.toLowerCase(),
  `${artifact.bytecode.object}${publisher.slice(2).padStart(64, "0")}`.toLowerCase(),
  "Creation bytecode or constructor publisher differs from the build",
);
assert.equal(
  (await rpc("eth_getCode", [address, receipt.blockNumber])).toLowerCase(),
  artifact.deployedBytecode.object.toLowerCase(),
  "Deployed bytecode differs from the build",
);
async function call(signature) {
  return rpc("eth_call", [
    { to: address, data: `0x${artifact.methodIdentifiers[signature]}` },
    receipt.blockNumber,
  ]);
}
assert.equal(BigInt(await call("publisher()")), BigInt(publisher), "Wrong initial publisher");
for (const getter of ["latestSequence()", "latestRoot()", "pendingPublisher()"]) {
  assert.equal(BigInt(await call(getter)), 0n, `${getter} must initially be zero`);
}

const manifest = {
  $schema: "./amoy.schema.json",
  status: "deployed",
  chainId: 80002,
  address,
  transactionHash: transaction.hash,
  blockNumber,
  compilerVersion: artifact.metadata.compiler.version,
  publisher,
};
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Verified chain 80002 deployment at ${address}, block ${blockNumber}; wrote ${outputPath}`,
);
