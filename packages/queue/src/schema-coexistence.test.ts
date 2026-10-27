import { randomUUID } from "node:crypto";
import { createSql, migrate } from "@yen/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureQueueSchema } from "./boss.js";
import { describePostgres } from "./test-utils.js";
import { WorkerRuntime } from "./worker.js";

describePostgres("Queue and Migration Runner Schema Coexistence", (adminUrl) => {
  const testDbName = `yen_queue_coexist_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;
  });

  afterAll(async () => {
    try {
      await sql.end({ timeout: 5 });
      await new Promise((r) => setTimeout(r, 200));
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)} WITH (FORCE)`;
    } catch {
      // Ignored
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it("coexists cleanly: repo migration runner owns public schema, pg-boss owns pgboss schema", async () => {
    // 1. Run repo migrations on the clean database
    await migrate(sql);

    // Verify public schema has app tables and migration tracking
    const publicTables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const appTableNames = publicTables.map((t) => t.tablename);
    expect(appTableNames).toContain("schema_migrations");
    expect(appTableNames).toContain("users");
    expect(appTableNames).toContain("funds");

    // At this point, pgboss schema does NOT exist yet
    const preSchemas = await sql`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'pgboss'
    `;
    expect(preSchemas).toHaveLength(0);

    // 2. Provision pgboss schema explicitly via tracked schema provisioner
    await ensureQueueSchema(targetUrl.toString(), "pgboss");

    // Verify pgboss schema now exists and contains queue tables
    const pgbossTables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'pgboss' ORDER BY tablename
    `;
    const queueTableNames = pgbossTables.map((t) => t.tablename);
    expect(queueTableNames).toContain("job");
    expect(queueTableNames).toContain("queue");
    expect(queueTableNames).toContain("version");

    // 3. Verify public schema was NOT polluted by queue tables
    const postPublicTables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    expect(postPublicTables.map((t) => t.tablename)).toEqual(appTableNames);

    // 4. Verify running repo migrations again is a clean no-op
    await migrate(sql);
  });

  it("fails fast in production mode when migrate: false and schema is not provisioned", async () => {
    // Attempting to run a worker with migrate: false against a non-existent schema
    const unprovisionedSchema = `pgboss_unprov_${randomUUID().replaceAll("-", "")}`;

    const worker = new WorkerRuntime({
      connectionString: targetUrl.toString(),
      schema: unprovisionedSchema,
      migrate: false, // Production safety default: do not run DDL
      queues: {
        "test-queue": { teamConcurrency: 1 },
      },
    });

    worker.registerHandler("test-queue", async () => {});

    // Must fail fast with an error indicating schema / version is missing, rather than silently modifying DDL
    await expect(worker.start()).rejects.toThrow();

    // Verify no untracked schema was created
    const createdSchemas = await sql`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${unprovisionedSchema}
    `;
    expect(createdSchemas).toHaveLength(0);
  });

  it("provisions idempotently: multiple ensureQueueSchema calls succeed without error", async () => {
    const idempSchema = `pgboss_idemp_${randomUUID().replaceAll("-", "")}`;

    await ensureQueueSchema(targetUrl.toString(), idempSchema);
    await ensureQueueSchema(targetUrl.toString(), idempSchema);

    const tables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = ${idempSchema} ORDER BY tablename
    `;
    expect(tables.map((t) => t.tablename)).toContain("job");

    await sql`DROP SCHEMA IF EXISTS ${sql(idempSchema)} CASCADE`;
  });
});
