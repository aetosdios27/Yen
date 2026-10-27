import { DEFAULT_QUEUES } from "./config.js";
import { WorkerRuntime } from "./worker.js";

const databaseUrl = process.env.DATABASE_URL ?? process.env.YEN_TEST_DATABASE_URL;

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL must be provided to run the worker process.\n");
  process.exit(1);
}

const worker = new WorkerRuntime({
  connectionString: databaseUrl,
  schema: process.env.QUEUE_SCHEMA ?? "pgboss",
  migrate: process.env.NODE_ENV !== "production",
  queues: DEFAULT_QUEUES,
});

worker.registerHandler("notifications", async (job) => {
  process.stdout.write(`Processing notification job ${job.id}\n`);
});

worker.registerHandler("reconciliation", async (job) => {
  process.stdout.write(`Processing reconciliation job ${job.id}\n`);
});

worker.registerHandler("blockchain-anchoring", async (job) => {
  process.stdout.write(`Processing blockchain anchoring job ${job.id}\n`);
});

await worker.start();
process.stdout.write("Worker runtime started and listening for jobs.\n");
