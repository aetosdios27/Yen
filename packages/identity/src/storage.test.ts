import { migrate, type Sql, uuidv7 } from "@yen/db";
import { type UserId, userIdSchema } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { generateYenId, type YenId } from "./format.js";
import { assignYenId } from "./storage.js";

async function createTestUser(sql: Sql, displayName = "Test User"): Promise<UserId> {
  const id = uuidv7();
  const phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  await sql`
    INSERT INTO users (id, phone, display_name)
    VALUES (${id}, ${phone}, ${displayName})
  `;
  return userIdSchema.parse(id);
}

databaseSuite("Yen ID storage and assignment", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("assigns a valid Yen ID to a user account and returns the exact same ID idempotently", async () => {
    const userId = await createTestUser(sql, "Ananya Sharma");

    const firstId = await assignYenId(sql, userId);
    expect(firstId).toMatch(/^[1-9][0-9]{8}$/);

    const secondId = await assignYenId(sql, userId);
    expect(secondId).toBe(firstId);

    const rows = await sql<{ yen_id: string; user_id: string }[]>`
      SELECT yen_id, user_id FROM yen_ids WHERE user_id = ${userId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.yen_id).toBe(firstId);
    expect(rows[0]?.user_id).toBe(userId);
  });

  it("handles 50-way concurrent assignment for one user, returning exactly one unique ID", async () => {
    const userId = await createTestUser(sql, "Concurrent User");

    const promises = Array.from({ length: 50 }, () => assignYenId(sql, userId));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(50);
    const uniqueIds = new Set(results);
    expect(uniqueIds.size).toBe(1);

    const singleId = results[0];
    expect(singleId).toBeDefined();
    expect(singleId).toMatch(/^[1-9][0-9]{8}$/);

    const dbRows = await sql<{ yen_id: string; user_id: string }[]>`
      SELECT yen_id, user_id FROM yen_ids WHERE user_id = ${userId}
    `;
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]?.yen_id).toBe(singleId);
  });

  it("retries and recovers when a generated ID collides with an existing Yen ID", async () => {
    const userA = await createTestUser(sql, "User A");
    const userB = await createTestUser(sql, "User B");

    // Assign an ID to User A
    const idA = await assignYenId(sql, userA);

    // For User B, force generator to collide with User A's ID on first attempt, then generate fresh
    let attempts = 0;
    const collidingGenerator = (): YenId => {
      attempts++;
      if (attempts === 1) {
        return idA; // Collision on first try!
      }
      return generateYenId();
    };

    const idB = await assignYenId(sql, userB, { idGenerator: collidingGenerator });
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(idB).not.toBe(idA);
    expect(idB).toMatch(/^[1-9][0-9]{8}$/);

    const rowB = await sql<{ yen_id: string }[]>`
      SELECT yen_id FROM yen_ids WHERE user_id = ${userB}
    `;
    expect(rowB[0]?.yen_id).toBe(idB);
  });

  it("recovers from a collision inside the caller's transaction", async () => {
    const userA = await createTestUser(sql);
    const userB = await createTestUser(sql);
    const occupied = await assignYenId(sql, userA);
    let attempts = 0;
    await sql.begin(async (tx) => {
      const assigned = await assignYenId(tx, userB, {
        idGenerator: () => (++attempts === 1 ? occupied : generateYenId()),
      });
      expect(assigned).not.toBe(occupied);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(await tx`SELECT 1 AS value`).toHaveLength(1);
    });
  });

  it("keeps a tombstone row when a user is deleted and guarantees the ID can never be re-issued", async () => {
    const userId = await createTestUser(sql, "User To Be Erased");
    const assignedId = await assignYenId(sql, userId);

    // Verify row exists and is bound to user
    const [rowBefore] = await sql<{ yen_id: string; user_id: string | null }[]>`
      SELECT yen_id, user_id FROM yen_ids WHERE yen_id = ${assignedId}
    `;
    expect(rowBefore).toBeDefined();
    expect(rowBefore?.user_id).toBe(userId);

    // Delete the user from the users table (e.g. account erasure)
    await sql`DELETE FROM users WHERE id = ${userId}`;

    // ON DELETE SET NULL must preserve the row as a tombstone
    const [tombstone] = await sql<{ yen_id: string; user_id: string | null }[]>`
      SELECT yen_id, user_id FROM yen_ids WHERE yen_id = ${assignedId}
    `;
    expect(tombstone).toBeDefined();
    expect(tombstone?.yen_id).toBe(assignedId);
    expect(tombstone?.user_id).toBeNull();

    // Invariant proof: Attempting to insert that exact same Yen ID fails with primary key violation
    const newUser = await createTestUser(sql, "New Account");
    await expect(
      sql`
        INSERT INTO yen_ids (yen_id, user_id)
        VALUES (${assignedId}, ${newUser})
      `,
    ).rejects.toMatchObject({
      code: "23505", // PostgreSQL unique_violation
    });

    // Invariant proof: assignYenId for a new user will never re-issue the tombstone ID
    const newAssignedId = await assignYenId(sql, newUser);
    expect(newAssignedId).not.toBe(assignedId);

    // The tombstone remains permanently null and undisturbed
    const [tombstoneCheck] = await sql<{ yen_id: string; user_id: string | null }[]>`
      SELECT yen_id, user_id FROM yen_ids WHERE yen_id = ${assignedId}
    `;
    expect(tombstoneCheck?.user_id).toBeNull();
  });

  it("enforces table CHECK constraint (^[1-9][0-9]{8}$) against invalid formats", async () => {
    const user = await createTestUser(sql, "Check Constraint User");

    // Leading zero refused by CHECK constraint
    await expect(
      sql`INSERT INTO yen_ids (yen_id, user_id) VALUES ('012345678', ${user})`,
    ).rejects.toMatchObject({
      code: "23514", // check_violation
    });

    // 8 digits refused
    await expect(
      sql`INSERT INTO yen_ids (yen_id, user_id) VALUES ('12345678', ${user})`,
    ).rejects.toMatchObject({
      code: "23514",
    });

    // 10 digits refused
    await expect(
      sql`INSERT INTO yen_ids (yen_id, user_id) VALUES ('1234567890', ${user})`,
    ).rejects.toMatchObject({
      code: "23514",
    });

    // Letters refused
    await expect(
      sql`INSERT INTO yen_ids (yen_id, user_id) VALUES ('12345678A', ${user})`,
    ).rejects.toMatchObject({
      code: "23514",
    });
  });
});
