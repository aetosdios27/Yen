import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql } from "@yen/db";
import { runPersistedEvidenceIntegrityJob } from "./evidence-integrity-runner.js";
import { PostgresEvidenceStore } from "./evidence-store-postgres.js";
import { FileSystemStorageAdapter } from "./filesystem-storage.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const storageDirectory = process.env.EVIDENCE_STORAGE_DIR;
  if (!databaseUrl || !storageDirectory) {
    throw new Error("DATABASE_URL and EVIDENCE_STORAGE_DIR are required");
  }

  const sql = createSql(databaseUrl);
  try {
    const storage = await FileSystemStorageAdapter.open(storageDirectory);
    const store = new PostgresEvidenceStore(sql);
    const summary = await runPersistedEvidenceIntegrityJob(store, storage);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (summary.tamperedCount > 0 || summary.missingCount > 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Evidence check failed"}\n`);
    process.exitCode = 2;
  });
}
