import { beforeAll, expect, it } from "vitest";
import {
  assertForeignKeyIndexes,
  findForeignKeysWithoutIndices,
  verifyAllMigrationsForeignKeys,
} from "./foreign-keys.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";

databaseSuite("foreign key indexing discipline", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  it("verifies all foreign keys in the migrated schema have supporting indexes on leading columns", async () => {
    const violations = await findForeignKeysWithoutIndices(sql);
    expect(violations).toEqual([]);
    await expect(assertForeignKeyIndexes(sql)).resolves.toBeUndefined();
  });

  it("verifies every migration applied from scratch maintains the foreign key index invariant", async () => {
    // In our test database with migrations applied, verifyAllMigrationsForeignKeys checks all migrations
    const result = await verifyAllMigrationsForeignKeys(sql);
    expect(result.migrationCount).toBeGreaterThanOrEqual(2);
    expect(result.checkedConstraints).toBeGreaterThan(0);
  });

  it("mutation check: fails when a table introduces a foreign key without a supporting index", async () => {
    await sql`
      CREATE TABLE test_fk_mutation_child (
        id uuid PRIMARY KEY,
        parent_user_id uuid NOT NULL REFERENCES users(id)
      )
    `;

    try {
      const violations = await findForeignKeysWithoutIndices(sql);
      const childViolation = violations.find((v) => v.tableName === "test_fk_mutation_child");
      expect(childViolation).toBeDefined();
      expect(childViolation?.constraintName).toBe("test_fk_mutation_child_parent_user_id_fkey");
      expect(childViolation?.fkColumns).toEqual(["parent_user_id"]);
      expect(childViolation?.foreignTable).toBe("users");

      await expect(assertForeignKeyIndexes(sql)).rejects.toThrow(
        /test_fk_mutation_child_parent_user_id_fkey.*lacks a supporting index/,
      );
    } finally {
      await sql`DROP TABLE IF EXISTS test_fk_mutation_child CASCADE`;
    }
  });

  it("permits an unindexed foreign key when explicitly documented in the allowlist", async () => {
    await sql`
      CREATE TABLE test_fk_allowlist_child (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id)
      )
    `;

    try {
      const unallowed = await findForeignKeysWithoutIndices(sql);
      expect(unallowed.some((v) => v.tableName === "test_fk_allowlist_child")).toBe(true);

      const allowed = await findForeignKeysWithoutIndices(sql, {
        allowlist: [
          {
            tableName: "test_fk_allowlist_child",
            constraintName: "test_fk_allowlist_child_owner_id_fkey",
            reason: "Allowed for allowlist functionality test verification",
          },
        ],
      });
      expect(allowed.some((v) => v.tableName === "test_fk_allowlist_child")).toBe(false);
    } finally {
      await sql`DROP TABLE IF EXISTS test_fk_allowlist_child CASCADE`;
    }
  });

  it("rejects partial indexes as supporting indexes for foreign keys", async () => {
    await sql`
      CREATE TABLE test_partial_fk_child (
        id uuid PRIMARY KEY,
        parent_org_id uuid NOT NULL REFERENCES orgs(id)
      )
    `;
    // Create partial index (indpred IS NOT NULL)
    await sql`
      CREATE INDEX test_partial_fk_child_idx ON test_partial_fk_child(parent_org_id)
      WHERE parent_org_id IS NOT NULL
    `;

    try {
      const violations = await findForeignKeysWithoutIndices(sql);
      const violation = violations.find((v) => v.tableName === "test_partial_fk_child");
      expect(violation).toBeDefined();
    } finally {
      await sql`DROP TABLE IF EXISTS test_partial_fk_child CASCADE`;
    }
  });
});
