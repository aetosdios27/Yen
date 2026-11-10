import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeCleanupTarget,
  cleanDirectory,
  dropQueueSchemaSql,
  resolveEvidenceStorageDir,
  resolveQueueSchemaName,
  UnsafePathError,
} from "./demo-reset.js";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "yen-demo-reset-"));
}

describe("resolveEvidenceStorageDir", () => {
  it("defaults to apps/api/.data/evidence under the repo root", () => {
    const root = resolve("/fake/repo");
    expect(resolveEvidenceStorageDir({}, root)).toBe(
      resolve("/fake/repo", "apps/api/.data/evidence"),
    );
  });

  it("ignores an empty or whitespace-only override", () => {
    const root = resolve("/fake/repo");
    expect(resolveEvidenceStorageDir({ EVIDENCE_STORAGE_DIR: "" }, root)).toBe(
      resolve("/fake/repo", "apps/api/.data/evidence"),
    );
    expect(resolveEvidenceStorageDir({ EVIDENCE_STORAGE_DIR: "   " }, root)).toBe(
      resolve("/fake/repo", "apps/api/.data/evidence"),
    );
  });

  it("uses an absolute override verbatim", () => {
    const dir = resolve("/var/lib/yen/evidence");
    expect(resolveEvidenceStorageDir({ EVIDENCE_STORAGE_DIR: dir }, "/fake/repo")).toBe(dir);
  });

  it("resolves a relative override against apps/api like the dev server cwd", () => {
    expect(
      resolveEvidenceStorageDir({ EVIDENCE_STORAGE_DIR: "uploads" }, resolve("/fake/repo")),
    ).toBe(resolve("/fake/repo", "apps/api/uploads"));
  });
});

describe("resolveQueueSchemaName", () => {
  it("defaults to pgboss when unset or blank", () => {
    expect(resolveQueueSchemaName({})).toBe("pgboss");
    expect(resolveQueueSchemaName({ QUEUE_SCHEMA: "" })).toBe("pgboss");
    expect(resolveQueueSchemaName({ QUEUE_SCHEMA: "  " })).toBe("pgboss");
  });

  it("accepts plain lowercase identifiers", () => {
    expect(resolveQueueSchemaName({ QUEUE_SCHEMA: "pgboss_demo" })).toBe("pgboss_demo");
  });

  it("rejects identifiers that would break SQL quoting", () => {
    expect(() => resolveQueueSchemaName({ QUEUE_SCHEMA: 'pgboss"; DROP SCHEMA public' })).toThrow(
      /QUEUE_SCHEMA/,
    );
    expect(() => resolveQueueSchemaName({ QUEUE_SCHEMA: "Pgboss" })).toThrow(/QUEUE_SCHEMA/);
    expect(() => resolveQueueSchemaName({ QUEUE_SCHEMA: "9schema" })).toThrow(/QUEUE_SCHEMA/);
  });
});

describe("dropQueueSchemaSql", () => {
  it("quotes the validated schema name", () => {
    expect(dropQueueSchemaSql("pgboss")).toBe('DROP SCHEMA IF EXISTS "pgboss" CASCADE;');
    expect(dropQueueSchemaSql("pgboss_demo")).toBe('DROP SCHEMA IF EXISTS "pgboss_demo" CASCADE;');
  });

  it("refuses to interpolate unvalidated input", () => {
    expect(() => dropQueueSchemaSql('x"; DROP SCHEMA public CASCADE; DROP SCHEMA "y')).toThrow(
      /QUEUE_SCHEMA/,
    );
  });
});

describe("assertSafeCleanupTarget", () => {
  const root = resolve("/fake/repo");

  it("accepts a normal directory inside the repo root", () => {
    expect(() =>
      assertSafeCleanupTarget(resolve(root, "apps/api/.data/evidence"), root),
    ).not.toThrow();
  });

  it("accepts an absolute directory outside the repo root", () => {
    expect(() => assertSafeCleanupTarget(resolve("/var/lib/yen/evidence"), root)).not.toThrow();
  });

  it("rejects the filesystem root", () => {
    expect(() => assertSafeCleanupTarget("/", root)).toThrow(UnsafePathError);
  });

  it("rejects the repository root itself", () => {
    expect(() => assertSafeCleanupTarget(root, root)).toThrow(UnsafePathError);
  });

  it("rejects a parent of the repository root", () => {
    expect(() => assertSafeCleanupTarget(resolve(root, ".."), root)).toThrow(UnsafePathError);
  });
});

describe("cleanDirectory", () => {
  it("removes every file and subdirectory inside the target", async () => {
    const root = await makeTempRoot();
    const target = join(root, "evidence");
    const nested = join(target, "funds", "abc", "evidence", "xyz");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "bill.bin"), "0123456789");
    await writeFile(join(target, "loose.txt"), "seed");

    const result = await cleanDirectory(target, root);
    expect(result.path).toBe(resolve(target));
    expect(result.filesRemoved).toBe(2);
    await expect(readFile(join(target, "loose.txt"))).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("reports zero files for a missing directory without throwing", async () => {
    const root = await makeTempRoot();
    const result = await cleanDirectory(join(root, "does-not-exist"), root);
    expect(result.filesRemoved).toBe(0);
    await rm(root, { recursive: true, force: true });
  });

  it("refuses unsafe targets before touching the filesystem", async () => {
    const root = await makeTempRoot();
    await expect(cleanDirectory(sep, root)).rejects.toThrow(UnsafePathError);
    await expect(cleanDirectory(root, root)).rejects.toThrow(UnsafePathError);
    expect(await readFile(join(root)).catch(() => "exists")).toBe("exists");
    await rm(root, { recursive: true, force: true });
  });
});
