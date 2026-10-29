import { createHash, randomInt } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, createSql, ensureFundPseudonym, migrate, uuidv7 } from "@yen/db";
import { payloadSchemas } from "@yen/eventlog";
import { parseFundId } from "@yen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { runPersistedEvidenceIntegrityJob } from "./evidence-integrity-runner.js";
import { PostgresEvidenceStore } from "./evidence-store-postgres.js";
import { FileSystemStorageAdapter } from "./filesystem-storage.js";
import { buildOpaqueEvidenceKey } from "./storage.js";
import type { StoredEvidence } from "./stores.js";

const TEST_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

databaseSuite("Postgres evidence persistence", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;
  let storageRoot: string;
  let storage: FileSystemStorageAdapter;

  beforeAll(async () => {
    await migrate(sql);
    secondSql = createSql(url);
    storageRoot = await mkdtemp(join(tmpdir(), "yen-evidence-"));
    storage = await FileSystemStorageAdapter.open(storageRoot);
  });

  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  async function fundWithExpenses(expenseCount = 1) {
    const userId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Evidence Test')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Evidence Test Org', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Evidence Test Fund', '{}'::jsonb)`;
    const expenseIds: string[] = [];
    for (let index = 0; index < expenseCount; index++) {
      const expenseId = uuidv7();
      const now = new Date().toISOString();
      await sql`
        INSERT INTO expenses (id, fund_id, status, expense_data, created_at, updated_at)
        VALUES (${expenseId}, ${fundId}, 'draft', ${JSON.stringify({ id: expenseId, fundId })}::jsonb, ${now}, ${now})
      `;
      expenseIds.push(expenseId);
    }
    return { userId, fundId, expenseIds };
  }

  async function evidence(
    fundId: string,
    expenseId: string,
    bytes: Uint8Array = TEST_PDF,
  ): Promise<StoredEvidence> {
    const evidenceId = uuidv7();
    const objectKey = buildOpaqueEvidenceKey(fundId, expenseId, evidenceId);
    await storage.putObject(objectKey, bytes, "application/pdf");
    return {
      evidenceId,
      fundId,
      expenseId,
      fileSha256: createHash("sha256").update(bytes).digest("hex"),
      fileSizeBytes: bytes.byteLength,
      mimeType: "application/pdf",
      fileName: "invoice.pdf",
      objectKey,
      duplicateDetected: false,
      isDuplicate: false,
      vendorName: "Solar Supplies",
      gstin: "27AAPFU0939F1ZV",
      invoiceNumber: "INV-2026-001",
      invoiceDate: "2026-10-28",
      createdAt: new Date().toISOString(),
      scan: {
        scannerName: "ClamAV",
        signatureVersion: "ClamAV test signatures",
        result: "clean",
      },
    };
  }

  it("retains the row and bytes across new store and filesystem adapter instances", async () => {
    const { fundId, expenseIds } = await fundWithExpenses();
    const record = await evidence(fundId, expenseIds[0] as string);
    const firstStore = new PostgresEvidenceStore(sql);
    const saved = await firstStore.save(record);

    const restartedStore = new PostgresEvidenceStore(secondSql);
    const restartedStorage = await FileSystemStorageAdapter.open(storageRoot);
    const loaded = await restartedStore.getByExpense(fundId, record.expenseId);
    expect(loaded).toEqual([saved]);
    expect(await readFile(join(storageRoot, ...(record.objectKey as string).split("/")))).toEqual(
      Buffer.from(TEST_PDF),
    );
    expect(await restartedStorage.getObject(record.objectKey as string)).toMatchObject({
      data: TEST_PDF,
      sizeBytes: TEST_PDF.byteLength,
    });

    const report = await runPersistedEvidenceIntegrityJob(
      restartedStore,
      restartedStorage,
      100,
      fundId,
    );
    expect(report).toMatchObject({
      totalChecked: 1,
      validCount: 1,
      tamperedCount: 0,
      missingCount: 0,
    });
  });

  it("detects a replaced and a missing object during the persisted integrity scan", async () => {
    const { fundId, expenseIds } = await fundWithExpenses();
    const first = await evidence(fundId, expenseIds[0] as string);
    const second = await evidence(fundId, expenseIds[0] as string, new Uint8Array([1, 2, 3, 4]));
    const store = new PostgresEvidenceStore(sql);
    await store.save(first);
    await store.save(second);

    const firstPath = join(storageRoot, ...(first.objectKey as string).split("/"));
    const secondPath = join(storageRoot, ...(second.objectKey as string).split("/"));
    await writeFile(firstPath, new Uint8Array([9, 8, 7]));
    await rm(secondPath);

    const report = await runPersistedEvidenceIntegrityJob(store, storage, 100, fundId);
    expect(report.totalChecked).toBe(2);
    expect(report.tamperedItems).toEqual([
      {
        evidenceId: first.evidenceId,
        pinnedSha256: first.fileSha256,
        actualSha256: createHash("sha256")
          .update(new Uint8Array([9, 8, 7]))
          .digest("hex"),
      },
    ]);
    expect(report.missingItems).toMatchObject([
      { evidenceId: second.evidenceId, objectKey: second.objectKey },
    ]);
  });

  it("flags concurrent same-hash uploads on different expenses and later reads", async () => {
    const { fundId, expenseIds } = await fundWithExpenses(2);
    const first = await evidence(fundId, expenseIds[0] as string);
    const second = await evidence(fundId, expenseIds[1] as string);
    const store = new PostgresEvidenceStore(sql);

    const saved = await Promise.all([store.save(first), store.save(second)]);
    expect(saved.map((item) => item.duplicateDetected).filter(Boolean)).toHaveLength(1);
    const firstRead = await store.getByExpense(fundId, first.expenseId);
    const secondRead = await store.getByExpense(fundId, second.expenseId);
    expect(firstRead[0]?.duplicateExpenseId).toBe(second.expenseId);
    expect(secondRead[0]?.duplicateExpenseId).toBe(first.expenseId);
  });

  it("rejects updates to pinned file fields, deletes, and truncates", async () => {
    const { fundId, expenseIds } = await fundWithExpenses();
    const saved = await new PostgresEvidenceStore(sql).save(
      await evidence(fundId, expenseIds[0] as string),
    );
    await expect(
      sql`UPDATE evidence_records SET file_sha256 = ${"0".repeat(64)} WHERE evidence_id = ${saved.evidenceId}`,
    ).rejects.toThrow("append-only: UPDATE is forbidden");
    await expect(
      sql`UPDATE evidence_records SET file_size_bytes = file_size_bytes + 1 WHERE evidence_id = ${saved.evidenceId}`,
    ).rejects.toThrow("append-only: UPDATE is forbidden");
    await expect(
      sql`UPDATE evidence_records SET content_type = 'image/png' WHERE evidence_id = ${saved.evidenceId}`,
    ).rejects.toThrow("append-only: UPDATE is forbidden");
    await expect(
      sql`DELETE FROM evidence_records WHERE evidence_id = ${saved.evidenceId}`,
    ).rejects.toThrow("append-only: DELETE is forbidden");
    await expect(sql`TRUNCATE evidence_records`).rejects.toThrow(
      "append-only: TRUNCATE is forbidden",
    );
  });

  it("persists the unchanged evidence event payload with the exact uploaded hash", async () => {
    const { userId, fundId, expenseIds } = await fundWithExpenses();
    const record = await evidence(fundId, expenseIds[0] as string);
    await new PostgresEvidenceStore(sql).save(record);
    const parsedFundId = parseFundId(fundId);
    if (!parsedFundId.ok) throw new Error("Invalid test fund ID");
    const actor = await ensureFundPseudonym(sql, { userId, fundId: parsedFundId.value });
    const event = await appendEvent(sql, {
      fundId: parsedFundId.value,
      type: "expense.evidence_added",
      version: 1,
      actor,
      occurredAt: record.createdAt,
      payload: payloadSchemas["expense.evidence_added"].parse({
        expense_id: record.expenseId,
        evidence_id: record.evidenceId,
        content_sha256: record.fileSha256,
      }),
    });

    expect(event.payload).toEqual({
      expense_id: record.expenseId,
      evidence_id: record.evidenceId,
      content_sha256: record.fileSha256,
    });
  });
});
