import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FundId, fundIdSchema, orgIdSchema, type UserId, userIdSchema } from "@yen/shared";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { Sql } from "./client.js";
import { appendEvent } from "./events.js";
import { migrate } from "./migrate.js";
import { ensureFundPseudonym } from "./pseudonyms.js";
import { fundPseudonymRowSchema } from "./rows.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

const defaultMigrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

async function createTestUser(sql: Sql): Promise<UserId> {
  const id = uuidv7();
  const phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  await sql`
    INSERT INTO users (id, phone, display_name)
    VALUES (${id}, ${phone}, 'Test User')
  `;
  return userIdSchema.parse(id);
}

async function createTestFund(
  sql: Sql,
  ownerId: UserId,
): Promise<{ fundId: FundId; orgId: string }> {
  const orgId = uuidv7();
  const fundId = uuidv7();
  await sql`
    INSERT INTO orgs (id, name, legal_form, owner_id)
    VALUES (${orgId}, 'Test Org', 'society', ${ownerId})
  `;
  await sql`
    INSERT INTO funds (id, org_id, title, policy_json)
    VALUES (${fundId}, ${orgId}, 'Test Fund', '{}')
  `;
  return { fundId: fundIdSchema.parse(fundId), orgId };
}

databaseSuite("fund_pseudonyms per-person per-fund mapping", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("same user in two funds gets two different pseudonyms", async () => {
    const user = await createTestUser(sql);
    const { fundId: fund1 } = await createTestFund(sql, user);
    const { fundId: fund2 } = await createTestFund(sql, user);

    const psn1 = await ensureFundPseudonym(sql, { userId: user, fundId: fund1 });
    const psn2 = await ensureFundPseudonym(sql, { userId: user, fundId: fund2 });

    expect(psn1).not.toBe(psn2);
    expect(psn1).toMatch(/^psn_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(psn2).toMatch(/^psn_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);

    const rows = await sql`
      SELECT * FROM fund_pseudonyms
      WHERE user_id = ${user}
      ORDER BY fund_id
    `;
    expect(rows).toHaveLength(2);
    const sortedFunds = [fund1, fund2].sort();
    expect(fundPseudonymRowSchema.parse(rows[0])).toMatchObject({
      user_id: user,
      fund_id: sortedFunds[0],
    });
  });

  it("same user and fund twice gets the same one", async () => {
    const user = await createTestUser(sql);
    const { fundId } = await createTestFund(sql, user);

    const psn1 = await ensureFundPseudonym(sql, { userId: user, fundId });
    const psn2 = await ensureFundPseudonym(sql, { userId: user, fundId });

    expect(psn1).toBe(psn2);

    const rows = await sql`
      SELECT * FROM fund_pseudonyms
      WHERE user_id = ${user} AND fund_id = ${fundId}
    `;
    expect(rows).toHaveLength(1);
    expect(fundPseudonymRowSchema.parse(rows[0]).pseudonym_id).toBe(psn1.slice(4));
  });

  it("two users in one fund get different ones", async () => {
    const user1 = await createTestUser(sql);
    const user2 = await createTestUser(sql);
    const { fundId } = await createTestFund(sql, user1);

    const psn1 = await ensureFundPseudonym(sql, { userId: user1, fundId });
    const psn2 = await ensureFundPseudonym(sql, { userId: user2, fundId });

    expect(psn1).not.toBe(psn2);
  });

  it("no pseudonym id appears in two (user, fund) pairs", async () => {
    const users = await Promise.all([
      createTestUser(sql),
      createTestUser(sql),
      createTestUser(sql),
    ]);
    const funds = await Promise.all([
      createTestFund(sql, users[0]),
      createTestFund(sql, users[0]),
      createTestFund(sql, users[0]),
    ]);

    const pseudonyms: string[] = [];
    for (const u of users) {
      for (const f of funds) {
        const psn = await ensureFundPseudonym(sql, { userId: u, fundId: f.fundId });
        pseudonyms.push(psn);
      }
    }

    expect(pseudonyms).toHaveLength(9);
    const uniquePseudonyms = new Set(pseudonyms);
    expect(uniquePseudonyms.size).toBe(9);

    const duplicates = await sql`
      SELECT pseudonym_id, COUNT(*) AS count
      FROM fund_pseudonyms
      GROUP BY pseudonym_id
      HAVING COUNT(*) > 1
    `;
    expect(duplicates).toEqual([]);
  });

  it("50 concurrent calls converge", async () => {
    const user = await createTestUser(sql);
    const { fundId } = await createTestFund(sql, user);

    // 50 concurrent calls for the same user and fund
    const results = await Promise.all(
      Array.from({ length: 50 }, () => ensureFundPseudonym(sql, { userId: user, fundId })),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(1);

    const rows = await sql`
      SELECT * FROM fund_pseudonyms
      WHERE user_id = ${user} AND fund_id = ${fundId}
    `;
    expect(rows).toHaveLength(1);
    expect(`psn_${rows[0]?.pseudonym_id}`).toBe(results[0]);

    // 50 concurrent calls for 50 distinct pairs all succeed with distinct pseudonyms
    const pairs = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const u = await createTestUser(sql);
        const { fundId: f } = await createTestFund(sql, u);
        return { userId: u, fundId: f };
      }),
    );

    const diffResults = await Promise.all(pairs.map((pair) => ensureFundPseudonym(sql, pair)));
    const diffUnique = new Set(diffResults);
    expect(diffUnique.size).toBe(50);
  });

  it("the pseudonym a user gets can be used as actor in an appendEvent call", async () => {
    const user = await createTestUser(sql);
    const { fundId, orgId } = await createTestFund(sql, user);

    const actor = await ensureFundPseudonym(sql, { userId: user, fundId });

    const storedEvent = await appendEvent(sql, {
      fundId,
      type: "fund.created",
      version: 1,
      actor,
      occurredAt: new Date().toISOString(),
      payload: {
        org_id: orgIdSchema.parse(orgId),
        visibility: "private",
      },
    });

    expect(storedEvent.actor).toBe(actor);
    expect(storedEvent.seq).toBe(1);
    expect(storedEvent.fund_id).toBe(fundId);
  });
});

databaseSuite("fund_pseudonyms migration application on top of 0001-0004", (sql) => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yen-migration-step-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("the migration applies on top of 0001-0004 and its checksum is recorded", async () => {
    // 1. Copy 0001 - 0004 into tempDir and apply
    const m1 = await readFile(join(defaultMigrationsDir, "0001_app_tables.sql"));
    const m2 = await readFile(join(defaultMigrationsDir, "0002_waitlist.sql"));
    const m3 = await readFile(join(defaultMigrationsDir, "0003_fund_events.sql"));
    const m4 = await readFile(join(defaultMigrationsDir, "0004_shared_stores.sql"));
    await writeFile(join(tempDir, "0001_app_tables.sql"), m1);
    await writeFile(join(tempDir, "0002_waitlist.sql"), m2);
    await writeFile(join(tempDir, "0003_fund_events.sql"), m3);
    await writeFile(join(tempDir, "0004_shared_stores.sql"), m4);

    await migrate(sql, { dir: tempDir });

    const beforeMigrations =
      await sql`SELECT version, name FROM schema_migrations ORDER BY version`;
    expect(beforeMigrations).toHaveLength(4);

    // Verify fund_pseudonyms does not exist yet
    const beforeTable = await sql`
      SELECT to_regclass('public.fund_pseudonyms') AS name
    `;
    expect(beforeTable[0]?.name).toBeNull();

    // 2. Now copy 0005_fund_pseudonyms.sql and apply
    const m5 = await readFile(join(defaultMigrationsDir, "0005_fund_pseudonyms.sql"));
    await writeFile(join(tempDir, "0005_fund_pseudonyms.sql"), m5);

    await migrate(sql, { dir: tempDir });

    const afterMigrations = await sql`
      SELECT version, name, checksum FROM schema_migrations ORDER BY version
    `;
    expect(afterMigrations).toHaveLength(5);
    const m5Row = afterMigrations[4];
    expect(m5Row?.version).toBe(5);
    expect(m5Row?.name).toBe("0005_fund_pseudonyms.sql");
    expect(m5Row?.checksum).toBe(createHash("sha256").update(m5).digest("hex"));

    // Verify fund_pseudonyms table and index exist
    const afterTable = await sql`
      SELECT to_regclass('public.fund_pseudonyms') AS name
    `;
    expect(afterTable[0]?.name).toBe("fund_pseudonyms");

    // Verify index on fund_id exists
    const indexes = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'fund_pseudonyms'
      ORDER BY indexname
    `) as unknown as { indexname: string }[];
    const indexNames = indexes.map((row) => row.indexname);
    expect(indexNames).toContain("fund_pseudonyms_fund_id_idx");
  });
});
