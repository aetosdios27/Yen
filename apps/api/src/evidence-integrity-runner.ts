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
