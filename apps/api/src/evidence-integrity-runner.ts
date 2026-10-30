import { raiseAlert, type SqlClient } from "@yen/db";
import { runEvidenceIntegrityJob } from "./integrity-job.js";
import type { StorageAdapter } from "./storage.js";
import type { StoredEvidence } from "./stores.js";

export interface EvidencePageReader {
  scanPage(
    afterEvidenceId: string | undefined,
    limit: number,
    fundId?: string,
  ): Promise<readonly StoredEvidence[]>;
}

export async function* scanEvidencePages(
  store: EvidencePageReader,
  pageSize = 500,
  fundId?: string,
): AsyncGenerator<StoredEvidence> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError("Evidence page size must be between 1 and 1000");
  }
  let afterEvidenceId: string | undefined;
  while (true) {
    const page = await store.scanPage(afterEvidenceId, pageSize, fundId);
    if (page.length === 0) return;
    yield* page;
    afterEvidenceId = page.at(-1)?.evidenceId;
    if (page.length < pageSize) return;
  }
}

export function runPersistedEvidenceIntegrityJob(
  store: EvidencePageReader,
  storage: StorageAdapter,
  pageSize = 500,
  fundId?: string,
) {
  return runEvidenceIntegrityJob(scanEvidencePages(store, pageSize, fundId), storage);
}

/** Dedup key for the platform-wide integrity_check_failure alert. */
export const INTEGRITY_JOB_ALERT_KEY = "evidence-integrity-job";

/**
 * Runs the persisted integrity job. When the job itself throws (for example the
 * evidence store or storage is unreachable), a platform alert with fund_id NULL
 * is raised, deduplicated across repeated failures, and the error is rethrown.
 * Tampered or missing files are reported in the summary, not as job failures.
 */
export async function runPersistedEvidenceIntegrityJobWithAlert(
  sql: SqlClient,
  store: EvidencePageReader,
  storage: StorageAdapter,
  pageSize = 500,
  fundId?: string,
) {
  try {
    return await runPersistedEvidenceIntegrityJob(store, storage, pageSize, fundId);
  } catch (error) {
    await raiseAlert(sql, {
      fundId: null,
      alertType: "integrity_check_failure",
      severity: "critical",
      title: "Evidence integrity job failed",
      details: `The evidence integrity job threw before completing: ${error instanceof Error ? error.message : String(error)}`,
      entityType: "integrity_job",
      entityId: INTEGRITY_JOB_ALERT_KEY,
      dedupKey: INTEGRITY_JOB_ALERT_KEY,
    });
    throw error;
  }
}
