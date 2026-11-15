import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANVIL_DEV_ADDRESS,
  ANVIL_DEV_PRIVATE_KEY,
  appChainEnv,
  localChainRpcUrl,
  resetLocalChain,
  workerChainEnv,
} from "./dev-chain.js";

let server: Server | undefined;

async function serveRpc(chainId: number): Promise<{ url: string; methods: string[] }> {
  const methods: string[] = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const { method } = JSON.parse(body) as { method: string };
      methods.push(method);
      const result = method === "eth_chainId" ? `0x${chainId.toString(16)}` : null;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, methods };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe("local chain configuration", () => {
  it("defaults to 8545 and honours ANVIL_PORT", () => {
    expect(localChainRpcUrl({})).toBe("http://127.0.0.1:8545");
    expect(localChainRpcUrl({ ANVIL_PORT: "8546" })).toBe("http://127.0.0.1:8546");
  });

  it("hands the worker everything it needs to anchor locally and the apps only public values", () => {
    const rpc = "http://127.0.0.1:8545";
    const registry = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    expect(workerChainEnv(rpc, registry)).toMatchObject({
      ANCHOR_RPC_URL: rpc,
      ROOT_REGISTRY_ADDRESS: registry,
      ANCHOR_CHAIN_ID: "31337",
      ANCHOR_PRIVATE_KEY: ANVIL_DEV_PRIVATE_KEY,
      ANCHOR_ALLOW_LOCAL_SIGNER: "true",
      ANCHOR_SCHEDULE_INTERVAL_MINUTES: "1",
      QUEUE_MIGRATE: "true",
    });
    expect(JSON.stringify(appChainEnv(rpc, registry))).not.toContain(ANVIL_DEV_PRIVATE_KEY);
    expect(ANVIL_DEV_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("resetLocalChain", () => {
  it("wipes a chain with id 31337 back to genesis", async () => {
    const rpc = await serveRpc(31337);
    expect(await resetLocalChain(rpc.url)).toBe("reset");
    expect(rpc.methods).toEqual(["eth_chainId", "anvil_reset"]);
  });

  it("refuses to reset any other chain", async () => {
    const rpc = await serveRpc(80002);
    await expect(resetLocalChain(rpc.url)).rejects.toThrow("not 31337");
    expect(rpc.methods).toEqual(["eth_chainId"]);
  });

  it("reports an absent chain instead of failing", async () => {
    expect(await resetLocalChain("http://127.0.0.1:1")).toBe("unreachable");
  });
});
