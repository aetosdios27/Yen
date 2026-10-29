import postgres from "../../../packages/db/node_modules/postgres/src/index.js";
import { resolveBenchmarkDatabaseUrl, startAppendHammer } from "./bench-helpers.mjs";

let appendEvent = null;
try {
  const db = await import("@yen/db");
  if (typeof db.appendEvent === "function") {
    appendEvent = db.appendEvent;
  }
} catch {
  try {
    const db = await import("../../../packages/db/dist/index.js");
    if (typeof db.appendEvent === "function") {
      appendEvent = db.appendEvent;
    }
  } catch {
    appendEvent = null;
  }
}

/**
 * This script drops and rewrites `fund_events` and upserts seed rows in the database its URL names,
 * so it accepts only a loopback host and a `yen_test_*` database. The URL is parsed with the same
 * validator as packages/db, and no error message includes the URL.
 */
function resolveDatabaseUrl() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: benchmark script run manually outside turbo
  return resolveBenchmarkDatabaseUrl(process.env.YEN_TEST_DATABASE_URL);
}

// Connect with connection pool sized for concurrency tests
const sql = postgres(resolveDatabaseUrl(), {
  max: 32,
  idle_timeout: 30,
});

// Objects this script needs from migrations 0001 and 0003 (see README, Prerequisites).
const PREREQUISITES = {
  "table users (0001)": "to_regclass('users')",
  "table orgs (0001)": "to_regclass('orgs')",
  "table pseudonyms (0001)": "to_regclass('pseudonyms')",
  "table funds (0001)": "to_regclass('funds')",
  "function yen_fund_lock_key(uuid) (0003)": "to_regprocedure('yen_fund_lock_key(uuid)')",
  "function yen_fund_events_before_insert() (0003)":
    "to_regprocedure('yen_fund_events_before_insert()')",
};

// The 0003 trigger reads the chain head from a table named fund_events, so only one layout can
// exist at a time. Each layout is built under that name in turn.
const TABLE = "fund_events";

const LAYOUTS = [
  { label: "Unpart", partitions: 0, isolation: true },
  { label: "Hash16", partitions: 16, isolation: true },
  { label: "Hash32", partitions: 32, isolation: false },
];

const EVENT_COLUMNS = `
  fund_id uuid NOT NULL REFERENCES funds(id),
  seq bigint NOT NULL CHECK (seq >= 1),
  type text NOT NULL,
  version integer NOT NULL CHECK (version = 1),
  actor text NOT NULL CHECK (actor ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  occurred_at text NOT NULL CHECK (occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'),
  payload jsonb NOT NULL,
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  canonical_envelope text NOT NULL,
  PRIMARY KEY (fund_id, seq)
`;

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function summarizeLatencies(latencies) {
  if (latencies.length === 0) return { p50: 0, p90: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

async function checkPrerequisites() {
  if (typeof appendEvent !== "function") {
    throw new Error(
      "Missing prerequisite: appendEvent from @yen/db. " +
        "All event writes must go through appendEvent. " +
        "The event writer is introduced in PR #20 (branch origin/aetosdios27/yen-21-fund-events-persistence). " +
        "Merge or rebase onto PR #20 and build @yen/db (`pnpm --filter @yen/db build`) to run this benchmark.",
    );
  }
  const missing = [];
  for (const [name, probe] of Object.entries(PREREQUISITES)) {
    const [row] = await sql.unsafe(`SELECT ${probe} IS NOT NULL AS found`);
    if (!row.found) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing prerequisites: ${missing.join("; ")}. Apply them as described in docs/adr/YEN-58/README.md, Prerequisites.`,
    );
  }
}

async function setupFunds() {
  console.log("Setting up seed users, org, pseudonym and 100 funds...");

  // Seed user, org, pseudonym
  const userId = "00000000-0000-7000-8000-000000000001";
  const orgId = "00000000-0000-7000-8000-000000000002";
  const psnId = "00000000-0000-7000-8000-000000000003";

  await sql`
    INSERT INTO users (id, phone, display_name, locale)
    VALUES (${userId}, '+919876543210', 'Benchmark User', 'en')
    ON CONFLICT (id) DO NOTHING;
  `;
  await sql`
    INSERT INTO orgs (id, name, legal_form, owner_id)
    VALUES (${orgId}, 'Benchmark Org', 'society', ${userId})
    ON CONFLICT (id) DO NOTHING;
  `;
  await sql`
    INSERT INTO pseudonyms (pseudonym_id, user_id)
    VALUES (${psnId}, ${userId})
    ON CONFLICT (pseudonym_id) DO NOTHING;
  `;

  for (let i = 1; i <= 100; i++) {
    const fundId = `00000000-0000-7000-8000-${i.toString().padStart(12, "0")}`;
    await sql`
      INSERT INTO funds (id, org_id, title, target_paise, visibility_tier, policy_json, status)
      VALUES (
        ${fundId},
        ${orgId},
        ${`Benchmark Fund ${i}`},
        10000000,
        'public',
        ${sql.json({ quorum: 1 })},
        'active'
      )
      ON CONFLICT (id) DO NOTHING;
    `;
  }
}

/**
 * Drops and rebuilds fund_events for one layout (0 partitions means unpartitioned).
 */
async function createLayout({ partitions }) {
  await sql.unsafe(`DROP TABLE IF EXISTS ${TABLE} CASCADE;`);
  if (partitions === 0) {
    await sql.unsafe(`CREATE TABLE ${TABLE} (${EVENT_COLUMNS});`);
  } else {
    await sql.unsafe(`CREATE TABLE ${TABLE} (${EVENT_COLUMNS}) PARTITION BY HASH (fund_id);`);
    for (let r = 0; r < partitions; r++) {
      await sql.unsafe(`
        CREATE TABLE ${TABLE}_p${r} PARTITION OF ${TABLE}
        FOR VALUES WITH (MODULUS ${partitions}, REMAINDER ${r});
      `);
    }
  }
  // Created after the partitions so the row trigger is cloned to each of them.
  await sql.unsafe(`
    CREATE TRIGGER fund_events_before_insert
    BEFORE INSERT ON ${TABLE}
    FOR EACH ROW
    EXECUTE FUNCTION yen_fund_events_before_insert();
  `);
}

/**
 * Execute an append transaction via appendEvent from @yen/db.
 * Every event write in the repository must go through appendEvent.
 */
async function appendToTable(_tableName, fundId, payloadInput, actor) {
  if (typeof appendEvent !== "function") {
    throw new Error(
      "Missing prerequisite: appendEvent from @yen/db. " +
        "All event writes must go through appendEvent. " +
        "Merge or rebase onto PR #20 (origin/aetosdios27/yen-21-fund-events-persistence) and build @yen/db.",
    );
  }
  const stored = await appendEvent(sql, {
    fundId,
    type: "donation.pledged",
    version: 1,
    actor,
    occurredAt: "2026-10-27T10:00:00.000Z",
    payload: payloadInput,
  });
  return { fundId: stored.fund_id, seq: stored.seq, hash: stored.hash };
}

/**
 * Benchmark append throughput and latency under N concurrent workers.
 */
async function benchmarkAppends({
  tableName,
  concurrency,
  totalAppends,
  fundSelector, // () => fundId
  description,
}) {
  const actor = "psn_00000000-0000-7000-8000-000000000003";
  const latencies = [];
  let appendsCompleted = 0;
  const startT = performance.now();

  async function worker() {
    while (true) {
      const idx = appendsCompleted++;
      if (idx >= totalAppends) break;
      const fundId = fundSelector();
      const payload = {
        donation_id: "00000000-0000-7000-8000-000000000004",
        amount_paise: 5000 + (idx % 100),
      };
      const t0 = performance.now();
      await appendToTable(tableName, fundId, payload, actor);
      const dt = performance.now() - t0;
      latencies.push(dt);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const totalDurationMs = performance.now() - startT;
  const throughput = totalAppends / (totalDurationMs / 1000);
  const stats = summarizeLatencies(latencies);

  console.log(`[${description}] Concurrency: ${concurrency}, Table: ${tableName}`);
  console.log(`  Throughput: ${throughput.toFixed(1)} appends/sec`);
  console.log(
    `  p50: ${stats.p50.toFixed(2)}ms, p90: ${stats.p90.toFixed(2)}ms, p99: ${stats.p99.toFixed(2)}ms, max: ${stats.max.toFixed(2)}ms`,
  );

  return {
    description,
    tableName,
    concurrency,
    totalAppends,
    totalDurationMs,
    throughput,
    ...stats,
  };
}

/**
 * Benchmark Hot Fund Isolation:
 * Satures Fund A with 8 workers, while an independent probe measures Fund B.
 * A hammer append that fails stops the run, and the function throws instead of reporting a probe
 * result that was measured without the claimed load.
 */
async function benchmarkHotFundIsolation(tableName) {
  console.log(`\n========================================`);
  console.log(`Running Hot-Fund Isolation Test on ${tableName}...`);
  console.log(`========================================`);

  const fundA = "00000000-0000-7000-8000-000000000001"; // Hot fund
  const fundB = "00000000-0000-7000-8000-000000000002"; // Unrelated probe fund
  const actor = "psn_00000000-0000-7000-8000-000000000003";

  // Background workers hammering Fund A
  const hammer = startAppendHammer(8, () =>
    appendToTable(
      tableName,
      fundA,
      {
        donation_id: "00000000-0000-7000-8000-000000000004",
        amount_paise: 1000,
      },
      actor,
    ),
  );

  let statsB;
  let throughputB;
  let hammerCount;
  try {
    // Let hammer start
    await new Promise((r) => setTimeout(r, 200));

    // Probe Fund B with 100 appends
    const probeLatencies = [];
    const probeStart = performance.now();
    const PROBE_COUNT = 100;
    for (let i = 0; i < PROBE_COUNT; i++) {
      const t0 = performance.now();
      await appendToTable(
        tableName,
        fundB,
        {
          donation_id: "00000000-0000-7000-8000-000000000005",
          amount_paise: 2000,
        },
        actor,
      );
      probeLatencies.push(performance.now() - t0);
    }
    const probeDurationMs = performance.now() - probeStart;
    statsB = summarizeLatencies(probeLatencies);
    throughputB = probeLatencies.length / (probeDurationMs / 1000);
  } finally {
    hammerCount = await hammer.stop();
  }

  console.log(
    `Fund B Probe Results during Fund A Saturation (Hammer completed ${hammerCount} appends on Fund A):`,
  );
  console.log(`  Throughput: ${throughputB.toFixed(1)} appends/sec`);
  console.log(
    `  p50: ${statsB.p50.toFixed(2)}ms, p90: ${statsB.p90.toFixed(2)}ms, p99: ${statsB.p99.toFixed(2)}ms, max: ${statsB.max.toFixed(2)}ms`,
  );

  return {
    tableName,
    hammerCount,
    throughputB,
    ...statsB,
  };
}

/**
 * Benchmark Read Shapes and Query Plans:
 * Populates test data and runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
 */
async function benchmarkReadShapes(tableName) {
  console.log(`\n========================================`);
  console.log(`Measuring Read Query Plans on ${tableName}...`);
  console.log(`========================================`);

  const fund1 = "00000000-0000-7000-8000-000000000001";

  // Shape 1: Latest event per fund
  const q1 = await sql.unsafe(
    `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM ${tableName}
    WHERE fund_id = $1::uuid
    ORDER BY seq DESC
    LIMIT 1;
  `,
    [fund1],
  );
  const plan1 = q1[0]["QUERY PLAN"][0];

  // Shape 2: Range by sequence (e.g. seq 50 to 150)
  const q2 = await sql.unsafe(
    `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM ${tableName}
    WHERE fund_id = $1::uuid AND seq BETWEEN 50 AND 150
    ORDER BY seq ASC;
  `,
    [fund1],
  );
  const plan2 = q2[0]["QUERY PLAN"][0];

  // Shape 3: Full chain scan for verification
  const q3 = await sql.unsafe(
    `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM ${tableName}
    WHERE fund_id = $1::uuid
    ORDER BY seq ASC;
  `,
    [fund1],
  );
  const plan3 = q3[0]["QUERY PLAN"][0];

  // Shape 4a: Anchoring batch read (per-fund checkpoint: events since last anchor)
  const q4a = await sql.unsafe(
    `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM ${tableName}
    WHERE fund_id = $1::uuid AND seq > 50
    ORDER BY seq ASC
    LIMIT 100;
  `,
    [fund1],
  );
  const plan4a = q4a[0]["QUERY PLAN"][0];

  // Shape 4b: Global timestamp scan without index
  const q4b = await sql.unsafe(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM ${tableName}
    WHERE occurred_at > '2026-10-27T00:00:00.000Z'
    ORDER BY occurred_at ASC
    LIMIT 100;
  `);
  const plan4b = q4b[0]["QUERY PLAN"][0];

  console.log(
    `Shape 1 (Latest Event): Node: ${plan1.Plan["Node Type"]}, Time: ${plan1["Execution Time"].toFixed(3)}ms, Buffers: hit=${plan1.Plan["Shared Hit Blocks"] || 0}, read=${plan1.Plan["Shared Read Blocks"] || 0}`,
  );
  console.log(
    `Shape 2 (Range by seq): Node: ${plan2.Plan["Node Type"]}, Time: ${plan2["Execution Time"].toFixed(3)}ms, Buffers: hit=${plan2.Plan["Shared Hit Blocks"] || 0}, read=${plan2.Plan["Shared Read Blocks"] || 0}`,
  );
  console.log(
    `Shape 3 (Full chain):   Node: ${plan3.Plan["Node Type"]}, Time: ${plan3["Execution Time"].toFixed(3)}ms, Buffers: hit=${plan3.Plan["Shared Hit Blocks"] || 0}, read=${plan3.Plan["Shared Read Blocks"] || 0}`,
  );
  console.log(
    `Shape 4a (Anchor/Fund): Node: ${plan4a.Plan["Node Type"]}, Time: ${plan4a["Execution Time"].toFixed(3)}ms, Buffers: hit=${plan4a.Plan["Shared Hit Blocks"] || 0}, read=${plan4a.Plan["Shared Read Blocks"] || 0}`,
  );
  console.log(
    `Shape 4b (Global Scan): Node: ${plan4b.Plan["Node Type"]}, Time: ${plan4b["Execution Time"].toFixed(3)}ms, Buffers: hit=${plan4b.Plan["Shared Hit Blocks"] || 0}, read=${plan4b.Plan["Shared Read Blocks"] || 0}`,
  );

  return {
    tableName,
    shape1: { time: plan1["Execution Time"], node: plan1.Plan["Node Type"] },
    shape2: { time: plan2["Execution Time"], node: plan2.Plan["Node Type"] },
    shape3: { time: plan3["Execution Time"], node: plan3.Plan["Node Type"] },
    shape4a: { time: plan4a["Execution Time"], node: plan4a.Plan["Node Type"] },
    shape4b: { time: plan4b["Execution Time"], node: plan4b.Plan["Node Type"] },
  };
}

async function main() {
  try {
    console.log("Starting Postgres Benchmark Suite for YEN-58...");
    await checkPrerequisites();

    const serverVersion = await sql`SHOW server_version;`;
    console.log(`PostgreSQL Server Version: ${serverVersion[0].server_version}`);
    await setupFunds();

    const results = {};
    const concurrencies = [1, 4, 8, 16];
    const randomFundSelector = () => {
      const idx = Math.floor(Math.random() * 50) + 1;
      return `00000000-0000-7000-8000-${idx.toString().padStart(12, "0")}`;
    };
    const hotFundId = "00000000-0000-7000-8000-000000000001";
    const actor = "psn_00000000-0000-7000-8000-000000000003";

    for (const layout of LAYOUTS) {
      const { label } = layout;
      console.log(`\n########################################`);
      console.log(
        `Layout: ${label} (${layout.partitions === 0 ? "unpartitioned" : `${layout.partitions} hash partitions`})`,
      );
      console.log(`########################################`);
      await createLayout(layout);

      // Seed baseline events for funds 1..50 (5 events each)
      console.log("Seeding initial events across funds...");
      for (let f = 1; f <= 50; f++) {
        const fundId = `00000000-0000-7000-8000-${f.toString().padStart(12, "0")}`;
        for (let s = 0; s < 5; s++) {
          await appendToTable(
            TABLE,
            fundId,
            { donation_id: "00000000-0000-7000-8000-000000000004", amount_paise: 1000 },
            actor,
          );
        }
      }

      // 1. Single Hot Fund contention benchmark
      console.log("\n========================================");
      console.log(`TEST 1: Single Hot Fund Append Contention (${label})`);
      console.log("========================================");
      for (const c of concurrencies) {
        results[`hot-${label}-c${c}`] = await benchmarkAppends({
          tableName: TABLE,
          concurrency: c,
          totalAppends: 150,
          fundSelector: () => hotFundId,
          description: `HotFund-${label}-c${c}`,
        });
      }

      // 2. Spread Funds benchmark
      console.log("\n========================================");
      console.log(`TEST 2: Spread Funds (50 Funds) Append (${label})`);
      console.log("========================================");
      for (const c of concurrencies) {
        results[`spread-${label}-c${c}`] = await benchmarkAppends({
          tableName: TABLE,
          concurrency: c,
          totalAppends: 300,
          fundSelector: randomFundSelector,
          description: `Spread-${label}-c${c}`,
        });
      }

      // 3. Hot Fund Isolation Test (unpartitioned and 16 partitions, as recorded in the ADR)
      if (layout.isolation) {
        results[`isolation-${label}`] = await benchmarkHotFundIsolation(TABLE);
      }

      // 4. Query Plans
      results[`plans-${label}`] = await benchmarkReadShapes(TABLE);
    }

    console.log("\nBenchmark suite completed successfully!");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
