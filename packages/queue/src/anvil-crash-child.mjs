import { createSql } from "@yen/db";
import { createPublicClient, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { AnchoringWorker, ViemRootChain } from "../dist/anchoring.js";

const rpc = process.env.ANVIL_RPC_URL;
const registry = process.env.ANVIL_REGISTRY_ADDRESS;
const fundId = process.env.ANVIL_FUND_ID;
const databaseUrl = process.env.YEN_ANVIL_TEST_DATABASE_URL;
if (!rpc || !registry || !fundId || !databaseUrl)
  throw new Error("Anvil child configuration is incomplete");

const chain = new ViemRootChain(rpc, registry, foundry);
const publicClient = createPublicClient({ chain: foundry, transport: http(rpc) });
const crashingChain = {
  chainId: chain.chainId,
  getRoot: (sequence) => chain.getRoot(sequence),
  getReceipt: (hash) => chain.getReceipt(hash),
  getPublication: (sequence) => chain.getPublication(sequence),
  getBlockNumber: () => chain.getBlockNumber(),
  getLatestSequence: () => chain.getLatestSequence(),
  getBalance: (address) => chain.getBalance(address),
  replacePending: (hash, root, sequence, signer) =>
    chain.replacePending(hash, root, sequence, signer),
  async publish(root, sequence, signer) {
    const hash = await chain.publish(root, sequence, signer);
    await publicClient.waitForTransactionReceipt({ hash });
    process.stdout.write("broadcasted\n");
    await new Promise(() => {});
    return hash;
  },
};
const signer = {
  getAccount: async () =>
    mnemonicToAccount("test test test test test test test test test test test junk", {
      addressIndex: 0,
    }),
};
const sql = createSql(databaseUrl);
new AnchoringWorker(sql, crashingChain, signer).runFund(fundId).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
