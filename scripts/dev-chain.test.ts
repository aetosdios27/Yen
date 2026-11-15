import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resetDemoChain } from "./demo-reset.js";
import {
  ANVIL_DEV_ADDRESS,
  ANVIL_DEV_PRIVATE_KEY,
  appChainEnv,
  localChainRpcUrl,
  probeLocalChain,
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

describe("probeLocalChain and resetLocalChain", () => {
  it("classifies a 31337 node as local and wipes it back to genesis", async () => {
    const rpc = await serveRpc(31337);
    expect(await probeLocalChain(rpc.url)).toBe("local");
    await resetLocalChain(rpc.url);
    expect(rpc.methods).toEqual(["eth_chainId", "eth_chainId", "anvil_reset"]);
  });

  it("classifies any other chain as foreign and refuses to reset it", async () => {
    const rpc = await serveRpc(80002);
    expect(await probeLocalChain(rpc.url)).toBe("foreign");
    await expect(resetLocalChain(rpc.url)).rejects.toThrow("not a 31337 local chain");
    expect(rpc.methods).not.toContain("anvil_reset");
  });

  it("classifies an absent chain as unreachable", async () => {
    expect(await probeLocalChain("http://127.0.0.1:1")).toBe("unreachable");
  });
});

describe("resetDemoChain", () => {
  it("skips a foreign chain with a clear message instead of failing the reset", async () => {
    const rpc = await serveRpc(80002);
    const probe = await probeLocalChain(rpc.url);
    expect(await resetDemoChain(rpc.url, probe)).toContain(
      "not a local demo chain, skipping chain reset",
    );
    expect(rpc.methods).not.toContain("anvil_reset");
  });

  it("wipes a local chain and reports an absent one", async () => {
    const rpc = await serveRpc(31337);
    expect(await resetDemoChain(rpc.url, "local")).toContain("wiped to genesis");
    expect(rpc.methods).toContain("anvil_reset");
    expect(await resetDemoChain("http://127.0.0.1:1", "unreachable")).toContain("nothing to reset");
  });
});
