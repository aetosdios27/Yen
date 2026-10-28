import { createApp } from "../src/app.js";
import { DefaultInFlightTracker } from "../src/dependencies.js";

async function runLoadTest() {
  const concurrencyLimit = 10;
  const inFlightTracker = new DefaultInFlightTracker();

  let releaseWork: () => void = () => {};
  const workGate = new Promise<void>((resolve) => {
    releaseWork = resolve;
  });

  const app = createApp({
    concurrencyLimit,
    inFlightTracker,
    readiness: async () => true,
    logger: { log: () => undefined },
  });

  app.get("/work", async (c) => {
    await workGate;
    return c.json({ ok: true }, 200);
  });

  const baseline = concurrencyLimit;
  const totalRequests = baseline * 5; // 5x baseline = 50 requests

  process.stdout.write(`Starting load test: baseline=${baseline}, load=${totalRequests} (5x)\n`);

  const initialHeap = process.memoryUsage().heapUsed;

  const requestPromises = Array.from({ length: totalRequests }, () =>
    app.request("/work", { method: "GET" }),
  );

  // Allow dispatch to register in flight
  await new Promise((r) => setTimeout(r, 50));

  // Verify health checks stay responsive and are not shed
  const healthRes = await app.request("/health");
  const readyRes = await app.request("/ready");

  if (healthRes.status !== 200 || readyRes.status !== 200) {
    throw new Error(
      `Health check failed during load: health=${healthRes.status}, ready=${readyRes.status}`,
    );
  }

  // Release the held work
  releaseWork();
  const responses = await Promise.all(requestPromises);

  const admitted = responses.filter((r) => r.status === 200);
  const shed = responses.filter((r) => r.status === 503);

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMb = ((finalHeap - initialHeap) / (1024 * 1024)).toFixed(2);

  process.stdout.write(`Admitted: ${admitted.length}/${totalRequests}\n`);
  process.stdout.write(`Shed (503): ${shed.length}/${totalRequests}\n`);
  process.stdout.write(`Heap delta: ${heapDeltaMb} MB\n`);
  process.stdout.write(`Health status: ${healthRes.status} OK\n`);
  process.stdout.write(`Ready status: ${readyRes.status} OK\n`);

  if (admitted.length !== baseline) {
    throw new Error(`Expected exactly ${baseline} admitted, got ${admitted.length}`);
  }
  if (shed.length !== totalRequests - baseline) {
    throw new Error(`Expected exactly ${totalRequests - baseline} shed, got ${shed.length}`);
  }

  process.stdout.write("Load test passed cleanly.\n");
}

await runLoadTest();
