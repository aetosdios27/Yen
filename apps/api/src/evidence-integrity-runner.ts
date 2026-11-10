import { raiseAlert, raiseAlertWithNotification, type SqlClient } from "@yen/db";
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

export async function runPersistedEvidenceIntegrityJobWithAlert(
  sql: SqlClient,
  store: EvidencePageReader,
  storage: StorageAdapter,
  pageSize = 500,
  fundId?: string,
) {
  try {
    return await runEvidenceIntegrityJob(
      scanEvidencePages(store, pageSize, fundId),
      storage,
      async (evidence, result) => {
        await raiseAlertWithNotification(sql, {
          fundId: evidence.fundId,
          alertType: "integrity_check_failure",
          severity: "critical",
          title: "Evidence integrity check failed",
          details:
            result.status === "tampered"
              ? "Stored evidence does not match its pinned SHA-256 hash."
              : "Stored evidence could not be read for integrity verification.",
          entityType: "evidence",
          entityId: evidence.evidenceId,
        });
      },
    );
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
