import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type ContainerEngine = "docker" | "podman";

export const LOCAL_CHAIN_ID = 31337;
export const ANVIL_CONTAINER = "yen-anvil";
export const DEFAULT_ANVIL_PORT = "8545";
export const DEFAULT_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Anvil's first well-known account: public in every Foundry install, funded only on throwaway chains.
export const ANVIL_DEV_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const ANVIL_DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // gitleaks:allow

const CONTRACTS_DIR = fileURLToPath(new URL("../contracts/", import.meta.url));
const CONTAINER_PROJECT_DIR = "/tmp/registry";
const DEPLOYED_PATTERN = /Deployed to: (0x[0-9a-fA-F]{40})/;

export function detectContainerEngine(): ContainerEngine | undefined {
  for (const engine of ["docker", "podman"] as const) {
    if (spawnSync(engine, ["compose", "version"], { stdio: "ignore" }).status === 0) return engine;
  }
  return undefined;
}

export function localChainRpcUrl(env: Pick<NodeJS.ProcessEnv, "ANVIL_PORT">): string {
  return `http://127.0.0.1:${env.ANVIL_PORT || DEFAULT_ANVIL_PORT}`;
}

export function workerChainEnv(rpcUrl: string, registryAddress: string): NodeJS.ProcessEnv {
  return {
    ANCHOR_RPC_URL: rpcUrl,
    ROOT_REGISTRY_ADDRESS: registryAddress,
    ANCHOR_CHAIN_ID: String(LOCAL_CHAIN_ID),
    ANCHOR_PRIVATE_KEY: ANVIL_DEV_PRIVATE_KEY,
    ANCHOR_ALLOW_LOCAL_SIGNER: "true",
    ANCHOR_SCHEDULE_INTERVAL_MINUTES: "1",
    QUEUE_MIGRATE: "true",
  };
}

export function appChainEnv(rpcUrl: string, registryAddress: string): NodeJS.ProcessEnv {
  return {
    REGISTRY_CONTRACT_ADDRESS: registryAddress,
    NEXT_PUBLIC_LOCAL_CHAIN_RPC_URL: rpcUrl,
  };
}

export async function rpcRequest(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(3000),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function isLocalChain(rpcUrl: string): Promise<boolean> {
  try {
    return Number(await rpcRequest(rpcUrl, "eth_chainId")) === LOCAL_CHAIN_ID;
  } catch {
    return false;
  }
}

export async function waitForChain(rpcUrl: string, maxAttempts = 30): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isLocalChain(rpcUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export function startChainContainer(engine: ContainerEngine, env: NodeJS.ProcessEnv): boolean {
  return (
    spawnSync(engine, ["compose", "--profile", "chain", "up", "-d", "chain"], {
      stdio: "inherit",
      env,
    }).status === 0
  );
}

function containerExec(engine: ContainerEngine, args: string[], input?: string) {
  return spawnSync(engine, ["exec", "-i", ANVIL_CONTAINER, ...args], {
    encoding: "utf8",
    input,
  });
}

function deployRegistry(engine: ContainerEngine): string {
  for (const file of ["foundry.toml", "src/RootRegistry.sol"]) {
    const copy = containerExec(
      engine,
      [
        "sh",
        "-c",
        `mkdir -p "$(dirname ${CONTAINER_PROJECT_DIR}/${file})" && cat > ${CONTAINER_PROJECT_DIR}/${file}`,
      ],
      readFileSync(`${CONTRACTS_DIR}${file}`, "utf8"),
    );
    if (copy.status !== 0)
      throw new Error(`Could not copy ${file} into ${ANVIL_CONTAINER}: ${copy.stderr}`);
  }
  const deploy = spawnSync(
    engine,
    [
      "exec",
      "--env",
      "AMOY_RPC_URL=unused",
      "--workdir",
      CONTAINER_PROJECT_DIR,
      ANVIL_CONTAINER,
      "forge",
      "create",
      "src/RootRegistry.sol:RootRegistry",
      "--rpc-url",
      "http://127.0.0.1:8545",
      "--private-key",
      ANVIL_DEV_PRIVATE_KEY,
      "--broadcast",
      "--constructor-args",
      ANVIL_DEV_ADDRESS,
    ],
    { encoding: "utf8" },
  );
  const address = DEPLOYED_PATTERN.exec(deploy.stdout)?.[1];
  if (deploy.status !== 0 || !address) {
    throw new Error(`RootRegistry deployment failed: ${deploy.stderr || deploy.stdout}`);
  }
  return address;
}

/** Reuses the registry already on a running chain, otherwise deploys it with forge inside the node container. */
export async function ensureRegistry(engine: ContainerEngine, rpcUrl: string): Promise<string> {
  const existing = await rpcRequest(rpcUrl, "eth_getCode", [DEFAULT_REGISTRY_ADDRESS, "latest"]);
  if (existing !== "0x") return DEFAULT_REGISTRY_ADDRESS;
  return deployRegistry(engine);
}

export function readLatestSequence(engine: ContainerEngine, registryAddress: string): bigint {
  const call = containerExec(engine, [
    "cast",
    "call",
    registryAddress,
    "latestSequence()(uint64)",
    "--rpc-url",
    "http://127.0.0.1:8545",
  ]);
  const value = call.stdout.trim().split(/\s+/)[0];
  if (call.status !== 0 || !value) throw new Error(`Could not read latestSequence: ${call.stderr}`);
  return BigInt(value);
}

export type ChainResetResult = "reset" | "unreachable";

/** Wipes a running local chain back to genesis; refuses anything that is not chain 31337. */
export async function resetLocalChain(rpcUrl: string): Promise<ChainResetResult> {
  let chainId: unknown;
  try {
    chainId = await rpcRequest(rpcUrl, "eth_chainId");
  } catch {
    return "unreachable";
  }
  if (Number(chainId) !== LOCAL_CHAIN_ID) {
    throw new Error(
      `Refusing to reset ${rpcUrl}: chain id ${String(chainId)} is not ${LOCAL_CHAIN_ID}`,
    );
  }
  await rpcRequest(rpcUrl, "anvil_reset");
  return "reset";
}
