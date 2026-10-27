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
      const childViolation = violations.find(
        (v) => v.tableName === "public.test_fk_mutation_child",
      );
      expect(childViolation).toBeDefined();
      expect(childViolation?.constraintName).toBe("test_fk_mutation_child_parent_user_id_fkey");
      expect(childViolation?.fkColumns).toEqual(["parent_user_id"]);
      expect(childViolation?.foreignTable).toBe("public.users");

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
      expect(unallowed.some((v) => v.tableName === "public.test_fk_allowlist_child")).toBe(true);

      const allowed = await findForeignKeysWithoutIndices(sql, {
        allowlist: [
          {
            tableName: "public.test_fk_allowlist_child",
            constraintName: "test_fk_allowlist_child_owner_id_fkey",
            reason: "Allowed for allowlist functionality test verification",
          },
        ],
      });
      expect(allowed.some((v) => v.tableName === "public.test_fk_allowlist_child")).toBe(false);
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
      const violation = violations.find((v) => v.tableName === "public.test_partial_fk_child");
      expect(violation).toBeDefined();
    } finally {
      await sql`DROP TABLE IF EXISTS test_partial_fk_child CASCADE`;
    }
  });

  it("rejects indexes where foreign key columns are in INCLUDE clause rather than key columns", async () => {
    await sql`
      CREATE TABLE test_fk_include_parent (
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        PRIMARY KEY (org_id, user_id)
      )
    `;
    await sql`
      CREATE TABLE test_fk_include_child (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        CONSTRAINT fk_include_composite FOREIGN KEY (org_id, user_id)
          REFERENCES test_fk_include_parent(org_id, user_id)
      )
    `;
    // Create an index on (org_id) INCLUDE (user_id).
    // user_id is a non-key attribute (indnkeyatts = 1, cardinality = 2).
    await sql`
      CREATE INDEX test_fk_include_child_idx ON test_fk_include_child (org_id) INCLUDE (user_id)
    `;

    try {
      const violations = await findForeignKeysWithoutIndices(sql);
      const violation = violations.find((v) => v.tableName === "public.test_fk_include_child");
      expect(violation).toBeDefined();
      expect(violation?.constraintName).toBe("fk_include_composite");

      // Verify that adding a true key-column index on both leading columns satisfies the check
      await sql`
        CREATE INDEX test_fk_include_child_proper_idx ON test_fk_include_child (org_id, user_id)
      `;
      const afterValid = await findForeignKeysWithoutIndices(sql);
      expect(
        afterValid.find((v) => v.tableName === "public.test_fk_include_child"),
      ).toBeUndefined();
    } finally {
      await sql`DROP TABLE IF EXISTS test_fk_include_child CASCADE`;
      await sql`DROP TABLE IF EXISTS test_fk_include_parent CASCADE`;
    }
  });

  it("detects unindexed foreign keys across custom application schemas", async () => {
    await sql`CREATE SCHEMA test_audit`;
    await sql`
      CREATE TABLE test_audit.events (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES public.users(id)
      )
    `;

    try {
      const violations = await findForeignKeysWithoutIndices(sql);
      const violation = violations.find((v) => v.tableName === "test_audit.events");
      expect(violation).toBeDefined();
      expect(violation?.foreignTable).toBe("public.users");
      expect(violation?.constraintName).toBe("events_user_id_fkey");

      // Verify schema-qualified allowlist entry permits it
      const allowed = await findForeignKeysWithoutIndices(sql, {
        allowlist: [
          {
            tableName: "test_audit.events",
            constraintName: "events_user_id_fkey",
            reason: "Audit events table tested in custom schema",
          },
        ],
      });
      expect(allowed.find((v) => v.tableName === "test_audit.events")).toBeUndefined();
    } finally {
      await sql`DROP SCHEMA IF EXISTS test_audit CASCADE`;
    }
  });
});
