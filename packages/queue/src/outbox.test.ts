import { randomUUID } from "node:crypto";
import { createSql } from "@yen/db";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildIdempotencyKey, transactionalEnqueue } from "./outbox.js";
import { describePostgres } from "./test-utils.js";

describePostgres("Transactional Outbox Enqueue", (adminUrl) => {
  const testDbName = `yen_queue_outbox_${randomUUID().replaceAll("-", "")}`;
  const admin = createSql(adminUrl);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${testDbName}`;
  const sql = createSql(targetUrl.toString());
  let boss: PgBoss;

  beforeAll(async () => {
    await admin`CREATE DATABASE ${admin(testDbName)}`;
    // Setup test domain table and pgboss schema
    await sql`
      CREATE TABLE domain_ledger_entries (
        id uuid PRIMARY KEY,
        amount bigint NOT NULL,
        description text NOT NULL
      )
    `;

    boss = new PgBoss({
      connectionString: targetUrl.toString(),
      schema: "pgboss",
      migrate: true,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue("outbox-domain-queue");
  });

  afterAll(async () => {
    try {
      await boss.stop();
      await sql.end({ timeout: 5 });
      await admin`DROP DATABASE IF EXISTS ${admin(testDbName)} WITH (FORCE)`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it("commits the domain write and the background job atomically together", async () => {
    const entryId = randomUUID();
    let enqueuedJobId: string | null = null;

    await sql.begin(async (tx) => {
      // 1. Domain write
      await tx`
        INSERT INTO domain_ledger_entries (id, amount, description)
        VALUES (${entryId}::uuid, 5000, 'Donation ledger credit')
      `;

      // 2. Transactional enqueue into outbox
      enqueuedJobId = await transactionalEnqueue(
        boss,
        tx,
        "outbox-domain-queue",
        { entryId, amount: 5000 },
        { singletonKey: `entry:${entryId}` },
      );
    });

    expect(enqueuedJobId).toBeDefined();

    // Verify domain write persisted
    const [entry] = await sql`
      SELECT id, amount, description FROM domain_ledger_entries WHERE id = ${entryId}::uuid
    `;
    expect(entry?.id).toBe(entryId);
    expect(entry?.amount).toBe(5000n);

    // Verify queue job persisted
    const [job] = await sql`
      SELECT id, name, data, singleton_key FROM pgboss.job WHERE id = ${enqueuedJobId}::uuid
    `;
    expect(job?.id).toBe(enqueuedJobId);
    expect(job?.singleton_key).toBe(`entry:${entryId}`);
    expect(job?.data).toEqual({ entryId, amount: 5000 });
  });

  it("rolls back the background job when the domain transaction aborts", async () => {
    const entryId = randomUUID();

    await expect(
      sql.begin(async (tx) => {
        await tx`
          INSERT INTO domain_ledger_entries (id, amount, description)
          VALUES (${entryId}::uuid, 10000, 'Failed payment debit')
        `;

        await transactionalEnqueue(
          boss,
          tx,
          "outbox-domain-queue",
          { entryId, amount: 10000 },
          { singletonKey: `entry:${entryId}` },
        );

        // Abort the transaction
        throw new Error("Simulated domain constraint violation");
      }),
    ).rejects.toThrow("Simulated domain constraint violation");

    // Domain row must NOT exist
    const [entry] = await sql`
      SELECT id FROM domain_ledger_entries WHERE id = ${entryId}::uuid
    `;
    expect(entry).toBeUndefined();

    // Job must NOT exist in the queue table
    const jobs = await sql`
      SELECT id FROM pgboss.job WHERE singleton_key = ${`entry:${entryId}`}
    `;
    expect(jobs).toHaveLength(0);
  });

  it("deduplicates duplicate enqueue attempts using idempotency singleton keys", async () => {
    const key = buildIdempotencyKey("fund", "fund-123", "event-456");

    let firstJobId: string | null = null;
    let duplicateJobId: string | null = null;

    await sql.begin(async (tx) => {
      firstJobId = await transactionalEnqueue(
        boss,
        tx,
        "outbox-domain-queue",
        { payload: "first attempt" },
        { singletonKey: key, singletonSeconds: 300 },
      );
    });

    expect(firstJobId).toBeDefined();

    // Second enqueue with identical singletonKey within the window
    await sql.begin(async (tx) => {
      duplicateJobId = await transactionalEnqueue(
        boss,
        tx,
        "outbox-domain-queue",
        { payload: "duplicate attempt" },
        { singletonKey: key, singletonSeconds: 300 },
      );
    });

    // pg-boss returns null when a job with the same singletonKey is already queued/active
    expect(duplicateJobId).toBeNull();

    // Exactly one job exists with this key
    const jobs = await sql`
      SELECT id, singleton_key FROM pgboss.job WHERE singleton_key = ${key}
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(firstJobId);
  });
});
