import { parseDatabaseUrl } from "@yen/db";
import { WorkerRuntime } from "./worker.js";

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");

const worker = new WorkerRuntime({
  connectionString: databaseUrl,
  schema: "pgboss",
  queues: {
    "crash-resilient-queue": {
      localConcurrency: 1,
      batchSize: 1,
      retryLimit: 1,
      retryDelay: 0,
      expireInSeconds: 2,
    },
  },
});

worker.registerHandler("crash-resilient-queue", async (job) => {
  // Announce to parent process that we picked up the job and started working on it
  process.stdout.write(`JOB_STARTED:${job.id}:${job.retryCount}\n`);
  // Hang mid-run so parent process can kill us
  await new Promise(() => {});
});

await worker.start();
process.stdout.write("READY\n");
