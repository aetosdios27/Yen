import v8 from "node:v8";
import {
  chainHead,
  computeEventHash,
  genesisHash,
  verifyChainStream,
} from "../../../packages/eventlog/dist/index.js";
import { splitBenchmarkTiming } from "./bench-helpers.mjs";

const FUND_ID = "00000000-0000-7000-8000-000000000001";
const ACTOR = "psn_00000000-0000-7000-8000-000000000002";
const DONATION_ID = "00000000-0000-7000-8000-000000000003";

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Pre-computes the target head for N synthetic events with the exact same
 * payload and chaining logic as makeNextEvent.
 */
async function computeTargetHead(totalEvents) {
  let prevHash = genesisHash;
  const payload = { donation_id: DONATION_ID, amount_paise: 1000 };
  const occurred_at = "2026-10-27T10:00:00.000Z";

  for (let seq = 1; seq <= totalEvents; seq++) {
    const unsigned = {
      fund_id: FUND_ID,
      seq,
      type: "donation.pledged",
      version: 1,
      actor: ACTOR,
      occurred_at,
      payload,
      prev_hash: prevHash,
    };
    prevHash = await computeEventHash(unsigned);
  }
  return chainHead({
    fundId: FUND_ID,
    count: totalEvents,
    latestHash: prevHash,
  });
}

/**
 * Generator producing synthetic chained events on the fly.
 * Uses makeNextEvent logic streaming one event at a time without storing the chain in memory.
 * Event construction and hashing are added to timing.generationMs, which is excluded from the
 * verification time reported by runBenchmark.
 */
async function* streamSyntheticEvents(totalEvents, timing) {
  let prevHash = genesisHash;
  const payload = { donation_id: DONATION_ID, amount_paise: 1000 };
  const occurred_at = "2026-10-27T10:00:00.000Z";

  for (let seq = 1; seq <= totalEvents; seq++) {
    const genStart = performance.now();
    const unsigned = {
      fund_id: FUND_ID,
      seq,
      type: "donation.pledged",
      version: 1,
      actor: ACTOR,
      occurred_at,
      payload,
      prev_hash: prevHash,
    };
    const hash = await computeEventHash(unsigned);
    const event = { ...unsigned, hash };
    prevHash = hash;
    timing.generationMs += performance.now() - genStart;
    yield event;
  }
}

async function runBenchmark(totalEvents) {
  console.log(`\n========================================`);
  console.log(`Benchmarking verifyChainStream for ${totalEvents.toLocaleString()} events`);
  console.log(`========================================`);

  if (globalThis.gc) {
    globalThis.gc();
  }

  const initialMemory = process.memoryUsage();
  console.log(
    `Initial RSS: ${formatBytes(initialMemory.rss)}, HeapUsed: ${formatBytes(initialMemory.heapUsed)}`,
  );

  console.log(`Precomputing authentic target head for ${totalEvents.toLocaleString()} events...`);
  const tPre0 = performance.now();
  const expectedHead = await computeTargetHead(totalEvents);
  const tPre1 = performance.now();
  console.log(
    `Target head computed in ${((tPre1 - tPre0) / 1000).toFixed(2)}s: ${expectedHead.latestHash}`,
  );

  if (globalThis.gc) {
    globalThis.gc();
  }
  const streamStartMemory = process.memoryUsage();

  console.log(`Starting verifyChainStream...`);
  const timing = { generationMs: 0 };
  const t0 = performance.now();
  let peakHeapUsed = streamStartMemory.heapUsed;
  let peakRss = streamStartMemory.rss;

  // Track memory periodically
  const memInterval = setInterval(() => {
    const m = process.memoryUsage();
    if (m.heapUsed > peakHeapUsed) peakHeapUsed = m.heapUsed;
    if (m.rss > peakRss) peakRss = m.rss;
  }, 250);

  const verificationResult = await verifyChainStream(
    streamSyntheticEvents(totalEvents, timing),
    expectedHead,
  );

  clearInterval(memInterval);
  const t1 = performance.now();

  const finalMemory = process.memoryUsage();
  if (finalMemory.heapUsed > peakHeapUsed) peakHeapUsed = finalMemory.heapUsed;
  if (finalMemory.rss > peakRss) peakRss = finalMemory.rss;

  // Wall time covers generation and verification together. Generation is measured inside the
  // generator, so verification is what remains. Handoff overhead between the two stays in
  // verification.
  const { wallMs, generationMs, verificationMs } = splitBenchmarkTiming(
    t1 - t0,
    timing.generationMs,
  );
  const verificationSec = verificationMs / 1000;
  const eventsPerSec = totalEvents / verificationSec;
  const usPerEvent = (verificationMs * 1000) / totalEvents;

  console.log(`Verification Result: ${JSON.stringify(verificationResult)}`);
  console.log(`Event generation (construction + hashing): ${(generationMs / 1000).toFixed(3)} s`);
  console.log(
    `Verification (event hashing excluded; includes stream handoff): ${verificationSec.toFixed(3)} s (${verificationMs.toFixed(1)} ms)`,
  );
  console.log(`Wall clock (generation + verification): ${(wallMs / 1000).toFixed(3)} s`);
  console.log(`Throughput (verification): ${eventsPerSec.toFixed(1)} events/sec`);
  console.log(`Latency per event (verification): ${usPerEvent.toFixed(2)} µs/event`);
  console.log(
    `Peak HeapUsed: ${formatBytes(peakHeapUsed)} (Delta: ${formatBytes(peakHeapUsed - streamStartMemory.heapUsed)})`,
  );
  console.log(`Peak RSS: ${formatBytes(peakRss)}`);

  return {
    totalEvents,
    generationSec: generationMs / 1000,
    verificationSec,
    wallSec: wallMs / 1000,
    eventsPerSec,
    usPerEvent,
    peakHeapUsedMB: (peakHeapUsed / 1024 / 1024).toFixed(2),
    heapDeltaMB: ((peakHeapUsed - streamStartMemory.heapUsed) / 1024 / 1024).toFixed(2),
    peakRssMB: (peakRss / 1024 / 1024).toFixed(2),
    verified: verificationResult.ok,
  };
}

const DEFAULT_SIZES = [1000, 10000, 100000, 1000000];

// Usage: node docs/adr/YEN-58/bench-verify-1m.mjs [size,size,...]
// Example: node docs/adr/YEN-58/bench-verify-1m.mjs 1000,10000,100000
function parseSizes(arg) {
  if (arg === undefined) return DEFAULT_SIZES;
  const sizes = arg.split(",").map((s) => Number(s));
  if (sizes.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error(`sizes must be comma-separated positive integers, got: ${arg}`);
  }
  return sizes;
}

async function main() {
  console.log(`Node.js version: ${process.version}`);
  console.log(
    `V8 heap limit: ${(v8.getHeapStatistics().heap_size_limit / 1024 / 1024).toFixed(0)} MB`,
  );

  // The first run also warms up the JIT.
  for (const size of parseSizes(process.argv[2])) {
    await runBenchmark(size);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
