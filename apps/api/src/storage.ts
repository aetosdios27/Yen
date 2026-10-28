import crypto from "node:crypto";

export interface StorageObject {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface UploadGrant {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

export interface StorageAdapter {
  putObject(key: string, data: Uint8Array, mimeType: string): Promise<void>;
  getObject(key: string): Promise<StorageObject>;
  deleteObject(key: string): Promise<void>;
  createUploadGrant(input: {
    fundId: string;
    expenseId: string;
    evidenceId: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadGrant>;
}

/**
 * Builds an opaque, cryptographically random, scope-bound object key for evidence storage.
 * Enforces hierarchical scoping (fund/expense/evidence) while including an unguessable nonce.
 */
export function buildOpaqueEvidenceKey(
  fundId: string,
  expenseId: string,
  evidenceId: string,
  nonce: string = crypto.randomBytes(16).toString("hex"),
): string {
  // Disallow path traversal or non-canonical characters
  if (!/^[0-9a-f-]{36}$/.test(fundId) || !/^[0-9a-f-]{36}$/.test(expenseId)) {
    throw new Error("Invalid fundId or expenseId for storage key construction");
  }
  return `funds/${fundId}/expenses/${expenseId}/evidence/${evidenceId}/${nonce}`;
}

/**
 * Production fail-closed unconfigured storage adapter.
 * Rejects all writes and reads until an explicit production storage provider (e.g. S3/GCS/R2)
 * is configured with verified credentials.
 */
export class UnconfiguredStorageAdapter implements StorageAdapter {
  async putObject(): Promise<never> {
    throw new Error(
      "StorageAdapter is unconfigured. Default fail-closed policy rejects storage writes in production.",
    );
  }

  async getObject(): Promise<never> {
    throw new Error(
      "StorageAdapter is unconfigured. Default fail-closed policy rejects storage reads in production.",
    );
  }

  async deleteObject(): Promise<never> {
    throw new Error("StorageAdapter is unconfigured.");
  }

  async createUploadGrant(): Promise<never> {
    throw new Error(
      "StorageAdapter is unconfigured. Cannot issue presigned upload grants without credentials.",
    );
  }
}

/**
 * In-memory deterministic storage adapter for testing and local development.
 * Allows simulating data tampering to test integrity verification.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<string, StorageObject>();

  async putObject(key: string, data: Uint8Array, mimeType: string): Promise<void> {
    this.objects.set(key, {
      data: new Uint8Array(data),
      mimeType,
      sizeBytes: data.length,
      createdAt: new Date().toISOString(),
    });
  }

  async getObject(key: string): Promise<StorageObject> {
    const obj = this.objects.get(key);
    if (!obj) {
      throw new Error(`Storage object not found for key: ${key}`);
    }
    return {
      data: new Uint8Array(obj.data),
      mimeType: obj.mimeType,
      sizeBytes: obj.sizeBytes,
      createdAt: obj.createdAt,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async createUploadGrant(input: {
    fundId: string;
    expenseId: string;
    evidenceId: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadGrant> {
    const objectKey = buildOpaqueEvidenceKey(input.fundId, input.expenseId, input.evidenceId);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
    return {
      objectKey,
      uploadUrl: `https://storage.local.yen/upload?key=${encodeURIComponent(objectKey)}`,
      expiresAt,
    };
  }

  /**
   * Helper for integrity testing: Simulates malicious or accidental tampering
   * of bytes stored at a specific key.
   */
  simulateTamper(key: string, tamperedBytes: Uint8Array): void {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`Cannot tamper non-existent key: ${key}`);
    this.objects.set(key, {
      ...obj,
      data: new Uint8Array(tamperedBytes),
      sizeBytes: tamperedBytes.length,
    });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}
