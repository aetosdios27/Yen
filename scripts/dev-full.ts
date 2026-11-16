import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { createSql, parseDatabaseUrl, seedDevDatabase } from "@yen/db";
import {
  assertLocalDemo,
  DEMO_PIN,
  prepareDemoAccounts,
  verifyDemoLogins,
} from "./demo-accounts.js";
import {
  appChainEnv,
  type ContainerEngine,
  detectContainerEngine,
  ensureRegistry,
  LOCAL_CHAIN_ID,
  localChainRpcUrl,
  readLatestSequence,
  startChainContainer,
  waitForChain,
  workerChainEnv,
} from "./dev-chain.js";
import { buildDevServerEnv } from "./dev-server-env.js";

async function isPostgresReachable(url: string): Promise<boolean> {
  try {
    const sql = createSql(url, { connectTimeout: 2 });
    await sql`SELECT 1`;
    await sql.end({ timeout: 1 });
    return true;
  } catch {
    return false;
  }
}

async function waitForPostgres(url: string, maxAttempts = 30): Promise<boolean> {
  process.stdout.write("Waiting for PostgreSQL to accept connections...");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isPostgresReachable(url)) {
      process.stdout.write(" ready!\n");
      return true;
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  process.stdout.write(" timed out.\n");
  return false;
}

function startContainers(engine: ContainerEngine | undefined): void {
  if (!engine) {
    process.stdout.write(
      "Note: Neither 'docker' nor 'podman' compose found in PATH. Checking local database...\n",
    );
    return;
  }
  const label = engine === "docker" ? "Docker" : "Podman";
  process.stdout.write(`Starting ${label} containers (PostgreSQL 16 & Redis)...\n`);
  const up = spawnSync(engine, ["compose", "up", "-d"], { stdio: "inherit" });
  if (up.status !== 0) {
    process.stderr.write(`Warning: '${engine} compose up -d' exited with non-zero status.\n`);
  }
}

type LocalChain = { rpcUrl: string; registryAddress: string; engine: ContainerEngine };

async function startLocalChain(
  engine: ContainerEngine | undefined,
  env: NodeJS.ProcessEnv,
): Promise<LocalChain | undefined> {
  const rpcUrl = localChainRpcUrl(env);
  try {
    if (!engine) throw new Error("no docker or podman compose found");
    process.stdout.write("\nStarting local anchoring chain (Anvil, chain id 31337)...\n");
    if (!startChainContainer(engine, env)) throw new Error("the chain container failed to start");
    if (!(await waitForChain(rpcUrl))) throw new Error(`no chain answered at ${rpcUrl}`);
    const registryAddress = await ensureRegistry(engine, rpcUrl);
    process.stdout.write(`✓ RootRegistry at ${registryAddress} on ${rpcUrl}\n`);
    return { rpcUrl, registryAddress, engine };
  } catch (error) {
    process.stderr.write(
      `Warning: local chain unavailable (${error instanceof Error ? error.message : String(error)}). Records will stay pending and nothing will anchor. Use --no-chain to skip this step.\n`,
    );
    return undefined;
  }
}

async function assertAnchorsMatchChain(
  sql: ReturnType<typeof createSql>,
  chain: LocalChain,
): Promise<void> {
  const [row] = await sql<{ max: string | null }[]>`
    SELECT MAX(chain_sequence)::text AS max FROM anchors WHERE chain_id = ${LOCAL_CHAIN_ID} AND status = 'confirmed'
  `;
  const recorded = BigInt(row?.max ?? 0);
  const onChain = readLatestSequence(chain.engine, chain.registryAddress);
  if (recorded > onChain) {
    throw new Error(
      `The database holds anchors up to sequence ${recorded} but the local chain is at ${onChain}. The chain was reset without the database. Run 'pnpm demo:reset' and start again.`,
    );
  }
}

function waitForPort(port: number, maxAttempts = 120): Promise<boolean> {
  return new Promise((resolve) => {
    let attempt = 0;
    const probe = () => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (++attempt >= maxAttempts) resolve(false);
        else setTimeout(probe, 1000);
      });
    };
    probe();
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/postgres";
  const parsedUrl = parseDatabaseUrl(databaseUrl, "DATABASE_URL");
  const withChain = !process.argv.includes("--no-chain");
  const demo = process.argv.includes("--demo");
  if (demo) assertLocalDemo({ ...process.env, DATABASE_URL: databaseUrl });
  let demoPinSecret: string | undefined;
  let demoUsers: Awaited<ReturnType<typeof seedDevDatabase>>["users"] = [];

  process.stdout.write("\n======================================================\n");
  process.stdout.write(" Yen One-Command Local Development Setup (dev:full)\n");
  process.stdout.write("======================================================\n\n");

  // Step 1: Start container services
  const engine = detectContainerEngine();
  startContainers(engine);

  // Step 2: Ensure PostgreSQL is reachable
  const ready = await waitForPostgres(parsedUrl);
  if (!ready) {
    process.stderr.write(
      `Error: PostgreSQL is not reachable at ${new URL(parsedUrl).host}. Please verify database is running.\n`,
    );
    process.exit(1);
  }

  // Step 3: Start the local anchoring chain and deploy RootRegistry
  const chain = withChain ? await startLocalChain(engine, process.env) : undefined;

  if (demo && withChain && !chain)
    throw new Error(
      "Local chain unavailable. Use --no-chain explicitly for a demo without anchoring.",
    );

  // Step 4: Run migrations and seed database
  process.stdout.write("\nRunning migrations and seeding demo dataset...\n");
  const sql = createSql(parsedUrl);
  try {
    const seedResult = await seedDevDatabase(sql);
    if (demo) {
      demoPinSecret = await prepareDemoAccounts(sql, seedResult.users, {
        ...process.env,
        DATABASE_URL: databaseUrl,
      });
      demoUsers = seedResult.users;
    }
    process.stdout.write(
      `✓ Database ready: ${seedResult.users.length} users, ${seedResult.expenses.length} expenses, ${seedResult.eventCount} events.\n`,
    );
    if (chain) await assertAnchorsMatchChain(sql, chain);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Step 5: Boot development servers (Next.js + Hono) and the anchoring worker
  const devEnv = buildDevServerEnv({
    ...process.env,
    DATABASE_URL: databaseUrl,
    ...(demoPinSecret ? { PIN_HMAC_SECRET: demoPinSecret } : {}),
    ...(chain ? appChainEnv(chain.rpcUrl, chain.registryAddress) : {}),
  });
  process.stdout.write(
    `\nBooting Next.js frontend (port ${devEnv.WEB_PORT}) and Hono API (port ${devEnv.API_PORT})...\n\n`,
  );

  if (chain) {
    const build = spawnSync("pnpm", ["--filter", "@yen/queue...", "build"], { stdio: "inherit" });
    if (build.status !== 0) throw new Error("Building the queue worker failed");
  }

  const child = spawn("pnpm", ["turbo", "run", "dev"], {
    stdio: "inherit",
    env: devEnv,
  });

  if (demo) {
    void waitForPort(Number(devEnv.API_PORT))
      .then(async (ready) => {
        if (!ready) throw new Error("Demo API did not start");
        if (!(await waitForPort(Number(devEnv.WEB_PORT))))
          throw new Error("Demo frontend did not start");
        await verifyDemoLogins(`http://localhost:${devEnv.API_PORT}`, demoUsers);
        process.stdout.write(
          `\nDemo logins verified. Open http://localhost:${devEnv.WEB_PORT}/login\n`,
        );
        for (const user of demoUsers.filter((user) => user.role !== "member")) {
          process.stdout.write(
            `${user.displayName} (${user.role}): ${user.phone} / demo PIN ${DEMO_PIN}\n`,
          );
        }
        process.stdout.write(
          withChain
            ? "Local chain requested; check the worker output for anchoring.\n"
            : "Anchoring disabled (--no-chain); new records remain pending.\n",
        );
      })
      .catch((error: unknown) => {
        process.stderr.write(
          `Demo readiness failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        child.kill("SIGINT");
        process.exitCode = 1;
      });
  }

  let worker: ChildProcess | undefined;
  let stopping = false;
  if (chain) {
    void waitForPort(Number(devEnv.API_PORT)).then(() => {
      if (stopping) return;
      process.stdout.write("\nStarting anchoring worker against the local chain...\n");
      worker = spawn("pnpm", ["--filter", "@yen/queue", "start"], {
        stdio: "inherit",
        env: { ...devEnv, ...workerChainEnv(chain.rpcUrl, chain.registryAddress) },
      });
    });
  }

  const cleanup = () => {
    stopping = true;
    process.stdout.write("\nShutting down dev servers...\n");
    worker?.kill("SIGINT");
    child.kill("SIGINT");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  child.on("exit", (code) => {
    stopping = true;
    worker?.kill("SIGINT");
    process.exit(process.exitCode ? Number(process.exitCode) : (code ?? 0));
  });
}

main().catch((error) => {
  process.stderr.write(`Error during dev:full setup: ${error.message}\n`);
  process.exit(1);
});
