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

// This process has no domain handlers yet. Every configured queue gets a handler that fails, so
// a job is never acknowledged as completed without work being done. The job retries and then
// moves to its dead-letter queue, where it can be inspected and replayed once a real handler exists.
for (const queueName of Object.keys(DEFAULT_QUEUES)) {
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

process.stdout.write("Worker runtime started and listening for jobs.\n");
