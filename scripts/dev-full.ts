import { spawn, spawnSync } from "node:child_process";
import { createSql, parseDatabaseUrl, seedDevDatabase } from "@yen/db";

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

function startContainers(): void {
  // Check for docker compose
  const dockerCheck = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (dockerCheck.status === 0) {
    process.stdout.write("Starting Docker containers (PostgreSQL 16 & Redis)...\n");
    const up = spawnSync("docker", ["compose", "up", "-d"], { stdio: "inherit" });
    if (up.status !== 0) {
      process.stderr.write("Warning: 'docker compose up -d' exited with non-zero status.\n");
    }
    return;
  }

  // Check for podman compose
  const podmanCheck = spawnSync("podman", ["compose", "version"], { stdio: "ignore" });
  if (podmanCheck.status === 0) {
    process.stdout.write("Starting Podman containers (PostgreSQL 16 & Redis)...\n");
    const up = spawnSync("podman", ["compose", "up", "-d"], { stdio: "inherit" });
    if (up.status !== 0) {
      process.stderr.write("Warning: 'podman compose up -d' exited with non-zero status.\n");
    }
    return;
  }

  process.stdout.write(
    "Note: Neither 'docker' nor 'podman' compose found in PATH. Checking local database...\n",
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/postgres";
  const parsedUrl = parseDatabaseUrl(databaseUrl, "DATABASE_URL");

  process.stdout.write("\n======================================================\n");
  process.stdout.write(" Yen One-Command Local Development Setup (dev:full)\n");
  process.stdout.write("======================================================\n\n");

  // Step 1: Start container services
  startContainers();

  // Step 2: Ensure PostgreSQL is reachable
  const ready = await waitForPostgres(parsedUrl);
  if (!ready) {
    process.stderr.write(
      `Error: PostgreSQL is not reachable at ${new URL(parsedUrl).host}. Please verify database is running.\n`,
    );
    process.exit(1);
  }

  // Step 3: Run migrations and seed database
  process.stdout.write("\nRunning migrations and seeding demo dataset...\n");
  const sql = createSql(parsedUrl);
  try {
    const seedResult = await seedDevDatabase(sql);
    process.stdout.write(
      `✓ Database ready: ${seedResult.users.length} users, ${seedResult.expenses.length} expenses, ${seedResult.eventCount} events.\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Step 4: Boot development servers (Next.js + Hono)
  process.stdout.write("\nBooting Next.js frontend (port 3000) and Hono API (port 3001)...\n\n");

  const child = spawn("pnpm", ["turbo", "run", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: process.env.PORT || "3001",
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
    },
  });

  const cleanup = () => {
    process.stdout.write("\nShutting down dev servers...\n");
    child.kill("SIGINT");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  process.stderr.write(`Error during dev:full setup: ${error.message}\n`);
  process.exit(1);
});
