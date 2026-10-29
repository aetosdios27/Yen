import {
  AnchoringWorker,
  KmsRootSigner,
  LocalDevRootSigner,
  registerAnchoringDiscovery,
  registerAnchorReconciliation,
  ViemRootChain,
} from "./anchoring.js";
import { DEFAULT_QUEUES } from "./config.js";
import { parseWorkerEnv } from "./env.js";
import { WorkerRuntime } from "./worker.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let env: ReturnType<typeof parseWorkerEnv>;
try {
  env = parseWorkerEnv(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid worker environment");
}

const worker = new WorkerRuntime({
  connectionString: env.DATABASE_URL,
  schema: env.QUEUE_SCHEMA,
  migrate: env.QUEUE_MIGRATE,
  queues: DEFAULT_QUEUES,
});

const anchorRpc = process.env.ANCHOR_RPC_URL;
const anchorAddress = process.env.ROOT_REGISTRY_ADDRESS;
const anchorConfigured = Boolean(anchorRpc && anchorAddress);
let anchorPublisherAddress: `0x${string}` | undefined;
if (anchorRpc && anchorAddress) {
  const chain = new ViemRootChain(anchorRpc, anchorAddress as `0x${string}`);
  const signer = process.env.ANCHOR_KMS_KEY_ID
    ? new KmsRootSigner()
    : LocalDevRootSigner.fromEnvironment();
  anchorPublisherAddress = (await signer.getAccount()).address;
  const anchoring = new AnchoringWorker(worker.getSql(), chain, signer);
  worker.registerHandler("blockchain-anchoring", async (job) => {
    const data = job.data as { fundId?: unknown };
    if (typeof data.fundId !== "string") throw new Error("Anchoring job requires a fundId");
    await anchoring.runFund(data.fundId);
  });
}

// This process has no domain handlers yet. Every configured queue gets a handler that fails, so
// a job is never acknowledged as completed without work being done. The job retries and then
// moves to its dead-letter queue, where it can be inspected and replayed once a real handler exists.
for (const queueName of Object.keys(DEFAULT_QUEUES)) {
  if (queueName === "blockchain-anchoring" && anchorConfigured) continue;
  worker.registerHandler(queueName, async (): Promise<void> => {
    throw new Error(
      `No job handler is implemented for queue '${queueName}'. The job is retried, then dead-lettered.`,
    );
  });
}

try {
  await worker.start();
} catch (error) {
  fail(`Worker failed to start: ${error instanceof Error ? error.message : String(error)}`);
}

// The runtime stops gracefully on the first SIGTERM/SIGINT and then removes its own listeners, after
// which the process exits once its event loop drains. A repeated signal in that window (a wrapper
// such as `pnpm start` forwarding a signal the process manager also sent) must not fall back to the
// default kill, which would report a signal exit instead of the worker's own status. Listeners stay
// installed in the CLI so repeated signals remain harmless, and resolving stop() writes the stopped
// confirmation line to stdout before exit.
let stoppedReported = false;
const handleShutdownSignal = () => {
  void worker
    .stop()
    .then(() => {
      if (!stoppedReported) {
        stoppedReported = true;
        process.stdout.write("Worker runtime stopped.\n");
      }
    })
    .catch((error) => {
      process.stderr.write(
        `Error during graceful shutdown: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, handleShutdownSignal);
}

process.stdout.write("Worker runtime started and listening for jobs.\n");
if (anchorConfigured) {
  void registerAnchoringDiscovery(worker.getBoss(), worker.getSql()).catch((error) => {
    process.stderr.write(
      `Anchoring discovery failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
  const chain = new ViemRootChain(anchorRpc as string, anchorAddress as `0x${string}`);
  void registerAnchorReconciliation(
    worker.getBoss(),
    worker.getSql(),
    chain,
    {
      async emit(alert) {
        process.stderr.write(`${JSON.stringify({ level: "alert", ...alert })}\n`);
      },
    },
    anchorPublisherAddress,
  ).catch((error) => {
    process.stderr.write(
      `Anchor reconciliation failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
