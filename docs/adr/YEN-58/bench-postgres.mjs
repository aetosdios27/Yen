import postgres from "../../../packages/db/node_modules/postgres/src/index.js";
import {
  canonicalize,
  computeEventHash,
  genesisHash,
} from "../../../packages/eventlog/dist/index.js";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: benchmark script run manually outside turbo
const PG_URL = process.env.DATABASE_URL || "postgres://postgres:pw@127.0.0.1:55444/postgres";

// Connect with connection pool sized for concurrency tests
const sql = postgres(PG_URL, {
  max: 32,
  idle_timeout: 30,
});

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

async function setupSchema() {
  console.log("Setting up test schemas and tables...");

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

  // Create 100 benchmark funds
  console.log("Creating 100 benchmark funds...");
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

  // 1. Unpartitioned table: fund_events_unpart
  await sql`DROP TABLE IF EXISTS fund_events_unpart CASCADE;`;
  await sql`
    CREATE TABLE fund_events_unpart (
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
    );
  `;
  await sql`
    CREATE TRIGGER fund_events_unpart_before_insert
    BEFORE INSERT ON fund_events_unpart
    FOR EACH ROW
    EXECUTE FUNCTION yen_fund_events_before_insert();
  `;

  // 2. Hash partitioned table (16 partitions): fund_events_hash16
  await sql`DROP TABLE IF EXISTS fund_events_hash16 CASCADE;`;
  await sql`
    CREATE TABLE fund_events_hash16 (
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
    ) PARTITION BY HASH (fund_id);
  `;
  for (let r = 0; r < 16; r++) {
    await sql.unsafe(`
      CREATE TABLE fund_events_hash16_p${r} PARTITION OF fund_events_hash16
      FOR VALUES WITH (MODULUS 16, REMAINDER ${r});
    `);
  }
  await sql`
    CREATE TRIGGER fund_events_hash16_before_insert
    BEFORE INSERT ON fund_events_hash16
    FOR EACH ROW
    EXECUTE FUNCTION yen_fund_events_before_insert();
  `;

  // 3. Hash partitioned table (32 partitions): fund_events_hash32
  await sql`DROP TABLE IF EXISTS fund_events_hash32 CASCADE;`;
  await sql`
    CREATE TABLE fund_events_hash32 (
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
    ) PARTITION BY HASH (fund_id);
  `;
  for (let r = 0; r < 32; r++) {
    await sql.unsafe(`
      CREATE TABLE fund_events_hash32_p${r} PARTITION OF fund_events_hash32
      FOR VALUES WITH (MODULUS 32, REMAINDER ${r});
    `);
  }
  await sql`
    CREATE TRIGGER fund_events_hash32_before_insert
    BEFORE INSERT ON fund_events_hash32
    FOR EACH ROW
    EXECUTE FUNCTION yen_fund_events_before_insert();
  `;

  console.log("Schema setup completed successfully.");
}

/**
 * Execute an append transaction against a given table name.
 * Uses advisory lock, reads head, computes next event, canonicalizes, and inserts.
 */
async function appendToTable(tableName, fundId, payloadInput, actor) {
  return await sql.begin(async (tx) => {
    // 1. Transaction-scoped advisory lock
    const lockKeyRes = await tx`SELECT yen_fund_lock_key(${fundId}::uuid) AS lock_key;`;
    const lockKey = lockKeyRes[0].lock_key;
    await tx`SELECT pg_advisory_xact_lock(${lockKey});`;

    // 2. Read latest head event for this fund
    const headRows = await tx.unsafe(
      `
      SELECT seq, hash, occurred_at
      FROM ${tableName}
      WHERE fund_id = $1::uuid
      ORDER BY seq DESC
      LIMIT 1;
    `,
      [fundId],
    );

    const prevSeq = headRows.length > 0 ? Number(headRows[0].seq) : 0;
    const prevHash = headRows.length > 0 ? headRows[0].hash : genesisHash;
    const seq = prevSeq + 1;
    const occurred_at = "2026-10-27T10:00:00.000Z";

    // 3. Build next event and hash
    const unsigned = {
      fund_id: fundId,
      seq,
      type: "donation.pledged",
      version: 1,
      actor,
      occurred_at,
      payload: payloadInput,
      prev_hash: prevHash,
    };
    const canonicalEnvelope = canonicalize(unsigned);
    const hash = await computeEventHash(unsigned);

    // 4. Insert into the target table
    await tx.unsafe(
      `
      INSERT INTO ${tableName} (
        fund_id, seq, type, version, actor, occurred_at, payload, prev_hash, hash, canonical_envelope
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `,
      [
        fundId,
        seq,
        unsigned.type,
        unsigned.version,
        unsigned.actor,
        unsigned.occurred_at,
        sql.json(unsigned.payload),
        unsigned.prev_hash,
        hash,
        canonicalEnvelope,
      ],
    );

    return { fundId, seq, hash };
  });
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
 */
async function benchmarkHotFundIsolation(tableName) {
  console.log(`\n========================================`);
  console.log(`Running Hot-Fund Isolation Test on ${tableName}...`);
  console.log(`========================================`);

  const fundA = "00000000-0000-7000-8000-000000000001"; // Hot fund
  const fundB = "00000000-0000-7000-8000-000000000002"; // Unrelated probe fund
  const actor = "psn_00000000-0000-7000-8000-000000000003";

  let hammerActive = true;
  let hammerCount = 0;

  // Background workers hammering Fund A
  const hammerWorkers = Array.from({ length: 8 }, async () => {
    while (hammerActive) {
      try {
        await appendToTable(
          tableName,
          fundA,
          {
            donation_id: "00000000-0000-7000-8000-000000000004",
            amount_paise: 1000,
          },
          actor,
        );
        hammerCount++;
      } catch {
        if (!hammerActive) break;
      }
    }
  });

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
  hammerActive = false;
  await Promise.all(hammerWorkers);

  const statsB = summarizeLatencies(probeLatencies);
  const throughputB = PROBE_COUNT / (probeDurationMs / 1000);

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
  console.log("Starting Postgres Benchmark Suite for YEN-58...");
  const serverVersion = await sql`SHOW server_version;`;
  console.log(`PostgreSQL Server Version: ${serverVersion[0].server_version}`);

  await setupSchema();

  const results = {
    unpartitioned: {},
    hash16: {},
    hash32: {},
    isolation: {},
    queryPlans: {},
  };

  // Seed baseline events for funds 1..50 (5 events each)
  console.log("Seeding initial events across funds...");
  for (let f = 1; f <= 50; f++) {
    const fundId = `00000000-0000-7000-8000-${f.toString().padStart(12, "0")}`;
    for (let s = 0; s < 5; s++) {
      await appendToTable(
        "fund_events_unpart",
        fundId,
        { donation_id: "00000000-0000-7000-8000-000000000004", amount_paise: 1000 },
        "psn_00000000-0000-7000-8000-000000000003",
      );
      await appendToTable(
        "fund_events_hash16",
        fundId,
        { donation_id: "00000000-0000-7000-8000-000000000004", amount_paise: 1000 },
        "psn_00000000-0000-7000-8000-000000000003",
      );
      await appendToTable(
        "fund_events_hash32",
        fundId,
        { donation_id: "00000000-0000-7000-8000-000000000004", amount_paise: 1000 },
        "psn_00000000-0000-7000-8000-000000000003",
      );
    }
  }

  const hotFundId = "00000000-0000-7000-8000-000000000001";
  const randomFundSelector = () => {
    const idx = Math.floor(Math.random() * 50) + 1;
    return `00000000-0000-7000-8000-${idx.toString().padStart(12, "0")}`;
  };

  const concurrencies = [1, 4, 8, 16];

  // 1. Single Hot Fund contention benchmark
  console.log("\n========================================");
  console.log("TEST 1: Single Hot Fund Append Contention");
  console.log("========================================");
  for (const c of concurrencies) {
    const count = 150;
    await benchmarkAppends({
      tableName: "fund_events_unpart",
      concurrency: c,
      totalAppends: count,
      fundSelector: () => hotFundId,
      description: `HotFund-Unpart-c${c}`,
    });
    await benchmarkAppends({
      tableName: "fund_events_hash16",
      concurrency: c,
      totalAppends: count,
      fundSelector: () => hotFundId,
      description: `HotFund-Hash16-c${c}`,
    });
    await benchmarkAppends({
      tableName: "fund_events_hash32",
      concurrency: c,
      totalAppends: count,
      fundSelector: () => hotFundId,
      description: `HotFund-Hash32-c${c}`,
    });
  }

  // 2. Spread Funds benchmark
  console.log("\n========================================");
  console.log("TEST 2: Spread Funds (50 Funds) Append");
  console.log("========================================");
  for (const c of concurrencies) {
    const count = 300;
    await benchmarkAppends({
      tableName: "fund_events_unpart",
      concurrency: c,
      totalAppends: count,
      fundSelector: randomFundSelector,
      description: `Spread-Unpart-c${c}`,
    });
    await benchmarkAppends({
      tableName: "fund_events_hash16",
      concurrency: c,
      totalAppends: count,
      fundSelector: randomFundSelector,
      description: `Spread-Hash16-c${c}`,
    });
    await benchmarkAppends({
      tableName: "fund_events_hash32",
      concurrency: c,
      totalAppends: count,
      fundSelector: randomFundSelector,
      description: `Spread-Hash32-c${c}`,
    });
  }

  // 3. Hot Fund Isolation Test
  results.isolation.unpart = await benchmarkHotFundIsolation("fund_events_unpart");
  results.isolation.hash16 = await benchmarkHotFundIsolation("fund_events_hash16");

  // 4. Query Plans
  results.queryPlans.unpart = await benchmarkReadShapes("fund_events_unpart");
  results.queryPlans.hash16 = await benchmarkReadShapes("fund_events_hash16");
  results.queryPlans.hash32 = await benchmarkReadShapes("fund_events_hash32");

  console.log("\nBenchmark suite completed successfully!");
  await sql.end();
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
