import { WorkerRuntime } from "./worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

const worker = new WorkerRuntime({
  connectionString: databaseUrl,
  schema: "pgboss",
  queues: {
    "crash-resilient-queue": {
      teamConcurrency: 1,
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
