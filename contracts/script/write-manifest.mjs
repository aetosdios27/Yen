import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const nonzeroAddress = z
  .string()
  .refine(
    (value) => /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n,
    "must be a nonzero 20-byte hex address",
  );
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexBytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const nonemptyHexBytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const hexQuantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
const envSchema = z.object({
  AMOY_RPC_URL: z
    .url()
    .refine((value) => /^https?:\/\//.test(value), "must be an absolute http(s) URL"),
  ROOT_REGISTRY_PUBLISHER: nonzeroAddress,
});
const broadcastSchema = z.object({
  chain: z.number().int(),
  transactions: z.array(
    z.object({
      transactionType: z.string(),
      contractName: z.string(),
      hash,
      contractAddress: nonzeroAddress,
    }),
  ),
});
const artifactSchema = z.object({
  bytecode: z.object({ object: nonemptyHexBytes }),
  deployedBytecode: z.object({ object: nonemptyHexBytes }),
  methodIdentifiers: z.object({
    "publisher()": z.string().regex(/^[0-9a-fA-F]{8}$/),
    "latestSequence()": z.string().regex(/^[0-9a-fA-F]{8}$/),
    "latestRoot()": z.string().regex(/^[0-9a-fA-F]{8}$/),
    "pendingPublisher()": z.string().regex(/^[0-9a-fA-F]{8}$/),
  }),
  metadata: z.object({ compiler: z.object({ version: z.string() }) }),
});
const rpcEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().int(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
const rpcResults = {
  eth_chainId: hexQuantity,
  eth_getTransactionReceipt: z.object({
    status: hexQuantity,
    transactionHash: hash,
    contractAddress: nonzeroAddress,
    blockNumber: hexQuantity,
    blockHash: hash,
  }),
  eth_getBlockByNumber: z.object({ hash }),
  eth_getTransactionByHash: z.object({
    to: z.union([addressSchema, z.null()]),
    input: hexBytes,
  }),
  eth_getCode: hexBytes,
  eth_call: nonemptyHexBytes,
};
const manifestSchema = z.strictObject({
  $schema: z.literal("./amoy.schema.json"),
  status: z.literal("deployed"),
  chainId: z.literal(80002),
  address: nonzeroAddress,
  transactionHash: hash,
  blockNumber: z.number().int().min(1),
  compilerVersion: z.literal("0.8.30+commit.73712a01"),
  publisher: nonzeroAddress,
});

class InputError extends Error {
  constructor(lines) {
    super(lines.join("\n"));
    this.lines = lines;
  }
}

function parseInput(schema, value, name) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new InputError(
    result.error.issues.map((issue) => {
      const path = issue.path
        .map((part) => (typeof part === "number" ? `[${part}]` : `.${part}`))
        .join("");
      return `${name}${path}: ${issue.message}`;
    }),
  );
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path, name) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${name}: cannot read file: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`${name}: invalid JSON`);
  }
}

async function main() {
  const [broadcastPath, outputPath] = parseInput(
    z.tuple([z.string().min(1), z.string().min(1)]),
    process.argv.slice(2),
    "arguments",
  );
  const contracts = fileURLToPath(new URL("../", import.meta.url));
  const { AMOY_RPC_URL: rpcUrl, ROOT_REGISTRY_PUBLISHER: publisher } = parseInput(
    envSchema,
    process.env,
    "env",
  );
  const artifact = parseInput(
    artifactSchema,
    readJson(resolve(contracts, "out/RootRegistry.sol/RootRegistry.json"), "artifact"),
    "artifact",
  );
  const broadcast = parseInput(broadcastSchema, readJson(broadcastPath, "broadcast"), "broadcast");
  check(broadcast.chain === 80002, "broadcast.chain: must be 80002");
  check(
    broadcast.transactions.length === 1,
    "broadcast.transactions: expected one deployment transaction",
  );
  const transaction = broadcast.transactions[0];
  check(
    transaction.transactionType === "CREATE",
    "broadcast.transactions[0].transactionType: expected CREATE",
  );
  check(
    transaction.contractName === "RootRegistry",
    "broadcast.transactions[0].contractName: expected RootRegistry",
  );

  async function rpc(method, params = []) {
    let response;
    try {
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`RPC ${method}: request failed: ${error.message}`);
    }
    check(response.ok, `RPC ${method}: HTTP status ${response.status}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`RPC ${method}: invalid JSON`);
    }
    const envelope = parseInput(rpcEnvelopeSchema, body, `RPC ${method}`);
    if (envelope.error) {
      throw new Error(`RPC ${method}.error: ${envelope.error.code} ${envelope.error.message}`);
    }
    return parseInput(rpcResults[method], envelope.result, `RPC ${method}.result`);
  }

  check(BigInt(await rpc("eth_chainId")) === 80002n, "RPC eth_chainId: must be 80002");
  const receipt = await rpc("eth_getTransactionReceipt", [transaction.hash]);
  check(
    receipt.status === "0x1",
    "RPC eth_getTransactionReceipt.result.status: deployment did not succeed",
  );
  check(
    receipt.transactionHash.toLowerCase() === transaction.hash.toLowerCase(),
    "RPC eth_getTransactionReceipt.result.transactionHash: differs from broadcast",
  );
  const address = receipt.contractAddress;
  check(
    address.toLowerCase() === transaction.contractAddress.toLowerCase(),
    "RPC eth_getTransactionReceipt.result.contractAddress: differs from broadcast",
  );
  const blockNumber = Number(BigInt(receipt.blockNumber));
  check(
    Number.isSafeInteger(blockNumber) && blockNumber > 0,
    "RPC eth_getTransactionReceipt.result.blockNumber: must be a positive safe integer",
  );
  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  check(
    block.hash === receipt.blockHash,
    "RPC eth_getBlockByNumber.result.hash: receipt is no longer in the canonical chain",
  );
  check(
    artifact.metadata.compiler.version === "0.8.30+commit.73712a01",
    "artifact.metadata.compiler.version: unexpected compiler",
  );
  const chainTransaction = await rpc("eth_getTransactionByHash", [transaction.hash]);
  check(
    chainTransaction.to === null,
    "RPC eth_getTransactionByHash.result.to: expected contract creation",
  );
  check(
    chainTransaction.input.toLowerCase() ===
      `${artifact.bytecode.object}${publisher.slice(2).padStart(64, "0")}`.toLowerCase(),
    "Creation bytecode or constructor publisher differs from the build",
  );
  check(
    (await rpc("eth_getCode", [address, receipt.blockNumber])).toLowerCase() ===
      artifact.deployedBytecode.object.toLowerCase(),
    "Deployed bytecode differs from the build",
  );
  async function call(signature) {
    return rpc("eth_call", [
      { to: address, data: `0x${artifact.methodIdentifiers[signature]}` },
      receipt.blockNumber,
    ]);
  }
  check(BigInt(await call("publisher()")) === BigInt(publisher), "Wrong initial publisher");
  for (const getter of ["latestSequence()", "latestRoot()", "pendingPublisher()"]) {
    check(BigInt(await call(getter)) === 0n, `${getter} must initially be zero`);
  }

  const manifest = parseInput(
    manifestSchema,
    {
      $schema: "./amoy.schema.json",
      status: "deployed",
      chainId: 80002,
      address,
      transactionHash: transaction.hash,
      blockNumber,
      compilerVersion: artifact.metadata.compiler.version,
      publisher,
    },
    "manifest",
  );
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Verified chain 80002 deployment at ${address}, block ${blockNumber}; wrote ${outputPath}`,
  );
}

main().catch((error) => {
  const lines =
    error instanceof InputError
      ? error.lines
      : [error instanceof Error ? error.message : String(error)];
  for (const line of lines) console.error(line.replace(/\s+/g, " "));
  process.exitCode = 1;
});
