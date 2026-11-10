/**
 * Public fund page cache spike benchmark (YEN-59).
 *
 * Drives 1,000 concurrent anonymous requests against the public fund summary
 * route, in process, against memory stores with counted reads. No network or
 * database is needed.
 *
 * Run from the repo root:
 *   pnpm exec tsx scripts/bench-fund-cache-spike.ts
 *
 * Read accounting (store level, one row per origin touch):
 *   page read    one origin produce of the summary read model, measured at the
 *                public donations store call, which runs exactly once per produce
 *   head lookup  the single indexed event hash query that validates cached copies
 *   auth lookup  the fundStore.get authorization read, which is a primary key
 *                lookup, runs once per request that reaches the page path and is
 *                deliberately never coalesced (304 answers skip it)
 *
 * The origin protection target: a 1,000 request burst against a cold or warm
 * origin costs at most 2 combined page reads plus head lookups, because
 * concurrent misses share one in-flight read and conditional requests are
 * answered from the event log head. The per IP miss budget (10 reads per
 * second) is kept at its default, so the burst also demonstrates that
 * single flight spends one budget token per burst rather than one per request.
 */
import { performance } from "node:perf_hooks";
import { createApp } from "../apps/api/src/app.js";
import {
  type AppDependencies,
  MemoryDisplayNameStore,
  MemoryFundStore,
} from "../apps/api/src/dependencies.js";
import { devPolicy } from "../apps/api/src/policy.js";
import { eventHashEtag, PublicReadCache } from "../apps/api/src/public-cache.js";

const concurrency = 1000;
const fundId = "00000000-0000-4000-8000-0000000000a1";
const orgId = "00000000-0000-4000-8000-0000000000b2";
const headHash = "c".repeat(64);

const counters = { pageReads: 0, headLookups: 0, authLookups: 0 };
const owner = { id: "00000000-0000-4000-8000-0000000000a2", role: "owner" as const };

function buildApp(options: {
  principal: AppDependencies["principal"];
  cache: PublicReadCache;
  fundStore: AppDependencies["fundStore"];
}) {
  return createApp({
    principal: options.principal,
    policy: devPolicy,
    fundStore: options.fundStore,
    displayNameStore: new MemoryDisplayNameStore(),
    publicReadCache: options.cache,
    publicFundReadStore: {
      donations: async () => {
        counters.pageReads += 1;
        return [];
      },
      pledgedPaise: async () => 0n,
      anchoredItems: async () => new Set<string>(),
    },
    publicFundHead: async (id) => {
      counters.headLookups += 1;
      return id === fundId ? { latestEventHash: headHash, orgId } : null;
    },
    logger: { log: () => undefined },
    idGenerator: () => fundId,
    concurrencyLimit: concurrency * 2,
    rateLimits: {
      ip: { capacity: concurrency * 4, refillMs: 60_000 },
      principal: { capacity: concurrency * 4, refillMs: 60_000 },
    },
  });
}

const summaryUrl = `/v1/funds/${fundId}/public/summary`;

async function createFund(app: ReturnType<typeof buildApp>) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "bench-fund" },
    body: JSON.stringify({
      name: "Spike fund",
      purpose: "Benchmark fixture",
      visibility: "public",
      targetPaise: "9000",
      upiVpa: "committee@yenbank",
      upiPayeeName: "Committee",
    }),
  });
  if (response.status !== 201) throw new Error(`Fund creation failed: ${response.status}`);
}

function statusCounts(responses: readonly Response[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const response of responses)
    counts.set(response.status, (counts.get(response.status) ?? 0) + 1);
  return counts;
}

function countsSummary(counts: ReadonlyMap<number, number>): string {
  return [...counts.entries()].map(([status, count]) => `${status}x${count}`).join(", ");
}

async function runSpike(
  name: string,
  requests: readonly Promise<Response>[],
): Promise<readonly Response[]> {
  const started = performance.now();
  const responses = await Promise.all(requests);
  const elapsedMs = Math.round(performance.now() - started);
  const perRequestMs = Math.round((elapsedMs / concurrency) * 1000) / 1000;
  console.log(
    `${name}: ${concurrency} requests in ${elapsedMs}ms (~${perRequestMs}ms per request), statuses ${countsSummary(statusCounts(responses))}`,
  );
  return responses;
}

type ReadCounts = { readonly pageReads: number; readonly headLookups: number };

function reportScenario(name: string, before: ReadCounts, after: ReadCounts): boolean {
  const deltaPage = after.pageReads - before.pageReads;
  const deltaHead = after.headLookups - before.headLookups;
  const total = deltaPage + deltaHead;
  const pass = total <= 2;
  console.log(
    `  ${name}: ${deltaPage} page read(s) + ${deltaHead} head lookup(s) = ${total} db read(s) ${pass ? "<= 2 ok" : "> 2 FAILED"}`,
  );
  return pass;
}

function assertAll(responses: readonly Response[], expected: number, name: string): boolean {
  const counts = statusCounts(responses);
  const unexpected = [...counts.entries()].filter(([status]) => status !== expected);
  if (unexpected.length > 0) {
    console.error(`  ${name}: unexpected statuses ${countsSummary(new Map(unexpected))}`);
    return false;
  }
  return true;
}

// Shared stores so the owner app's fund creation is visible to, and
// invalidates exactly what the anonymous app serves.
const cache = new PublicReadCache({ clock: () => Date.now() });
const memoryFunds = new MemoryFundStore();
const countedFunds: AppDependencies["fundStore"] = {
  get: (id) => {
    counters.authLookups += 1;
    return memoryFunds.get(id);
  },
  set: (id, record) => memoryFunds.set(id, record),
};
const app = buildApp({ principal: null, cache, fundStore: countedFunds });
await createFund(buildApp({ principal: owner, cache, fundStore: countedFunds }));

let failures = 0;

// Scenario 1: a CDN revalidation spike. Every request carries the current
// event hash validator and the origin cache is empty, as after a deploy.
const readsBeforeCold304 = { ...counters };
const cold304 = await runSpike(
  "cold conditional spike",
  Array.from({ length: concurrency }, () =>
    app.request(summaryUrl, { headers: { "if-none-match": eventHashEtag(fundId, headHash) } }),
  ),
);
if (!assertAll(cold304, 304, "cold conditional spike")) failures += 1;
if (!reportScenario("cold conditional spike", readsBeforeCold304, { ...counters })) failures += 1;

// Scenario 2: a cold unconditional spike, as when a cache flush or a new
// origin instance meets a traffic burst for one fund.
const readsBeforeColdMiss = { ...counters };
const coldMiss = await runSpike(
  "cold miss spike",
  Array.from({ length: concurrency }, () => app.request(summaryUrl)),
);
if (!assertAll(coldMiss, 200, "cold miss spike")) failures += 1;
if (!reportScenario("cold miss spike", readsBeforeColdMiss, { ...counters })) failures += 1;

// Scenario 3: warm traffic, served by the per instance cache.
const readsBeforeWarm = { ...counters };
const warm = await runSpike(
  "warm hit spike",
  Array.from({ length: concurrency }, () => app.request(summaryUrl)),
);
if (!assertAll(warm, 200, "warm hit spike")) failures += 1;
if (!reportScenario("warm hit spike", readsBeforeWarm, { ...counters })) failures += 1;

console.log(
  `per request authorization lookups (fundStore.get, primary key, never coalesced): ${counters.authLookups}`,
);

if (failures > 0) {
  console.error(`${failures} scenario(s) exceeded the origin protection budget`);
  process.exitCode = 1;
} else {
  console.log("all scenarios stayed within the origin protection budget");
}
