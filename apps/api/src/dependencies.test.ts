import { createSql } from "@yen/db";
import { InMemoryExpenseStore } from "@yen/ledger";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { defaultDependencies, selectVirusScanner, validatePinSecret } from "./dependencies.js";
import { PostgresEvidenceStore } from "./evidence-store-postgres.js";
import { MemoryStorageAdapter, type StorageAdapter } from "./storage.js";
import { MemoryEvidenceStore } from "./stores.js";
import { ClamAvVirusScannerAdapter, LocalDemoVirusScannerAdapter } from "./virus-scanner.js";

describe("durable evidence dependency defaults", () => {
  it("requires a configured evidence store and storage in production", async () => {
    const original = process.env.NODE_ENV;
    const sql = createSql("postgres://postgres:pw@localhost:55432/postgres");
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        defaultDependencies(
          Date.now,
          new InMemoryExpenseStore(),
          undefined,
          new MemoryStorageAdapter(),
        ),
      ).toThrow("PostgreSQL evidence store");
      expect(() =>
        defaultDependencies(
          Date.now,
          new InMemoryExpenseStore(),
          new PostgresEvidenceStore(sql),
          undefined,
        ),
      ).toThrow("configured durable evidence storage");
      expect(() =>
        defaultDependencies(
          Date.now,
          new InMemoryExpenseStore(),
          new MemoryEvidenceStore(),
          new MemoryStorageAdapter(),
        ),
      ).toThrow("PostgreSQL evidence store");
      expect(PostgresEvidenceStore).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
      await sql.end();
    }
  });
});

describe("dependencies PIN secret configuration", () => {
  it("rejects weak or short PIN secrets", () => {
    expect(() => validatePinSecret("")).toThrow("PIN_HMAC_SECRET");
    expect(() => validatePinSecret("short-secret")).toThrow("at least 32 characters");
    expect(() => validatePinSecret(12345)).toThrow("PIN_HMAC_SECRET");
    const validSecret = "a".repeat(32);
    expect(validatePinSecret(validSecret)).toBe(validSecret);
  });

  it("does not fall back to a hardcoded secret when PIN_HMAC_SECRET is unset", () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const deps = defaultDependencies();
      expect(deps.pinSecret).toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });

  it("validates and uses explicit PIN_HMAC_SECRET from environment", () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      const explicitSecret = "a".repeat(32);
      process.env.PIN_HMAC_SECRET = explicitSecret;
      const deps = defaultDependencies();
      expect(deps.pinSecret).toBe(explicitSecret);
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      } else {
        delete process.env.PIN_HMAC_SECRET;
      }
    }
  });

  it("permits non-PIN paths to function normally when PIN is unconfigured", async () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const app = createApp();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ status: "ok" });
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });

  it("fails closed on PIN paths when PIN service is unconfigured", async () => {
    const original = process.env.PIN_HMAC_SECRET;
    try {
      delete process.env.PIN_HMAC_SECRET;
      const app = createApp({
        principal: { id: "00000000-0000-4000-8000-000000000001" },
      });
      const res = await app.request("/v1/auth/pin/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "setup-unconfigured" },
        body: JSON.stringify({ pin: "482915" }),
      });
      expect(res.status).toBe(403);
      const err = (await res.json()) as { error: { details?: { message: string }[] } };
      expect(err.error.details?.[0]?.message).toContain("unconfigured");
    } finally {
      if (original !== undefined) {
        process.env.PIN_HMAC_SECRET = original;
      }
    }
  });
});

describe("virus scanner selection", () => {
  const durableStorage: StorageAdapter = {
    putObject: async () => undefined,
    getObject: async () => ({
      data: new Uint8Array(),
      mimeType: "application/octet-stream",
      sizeBytes: 0,
      createdAt: new Date().toISOString(),
    }),
    deleteObject: async () => undefined,
    createUploadGrant: async () => ({ objectKey: "", uploadUrl: "", expiresAt: "" }),
  };

  function withEnv(values: Record<string, string | undefined>, run: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(values)) {
      saved[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      run();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("uses ClamAV whenever CLAMAV_HOST is configured", () => {
    expect(selectVirusScanner({ CLAMAV_HOST: "clamav", NODE_ENV: "production" })).toBeInstanceOf(
      ClamAvVirusScannerAdapter,
    );
    expect(
      selectVirusScanner({ CLAMAV_HOST: "localhost", NODE_ENV: "development" }),
    ).toBeInstanceOf(ClamAvVirusScannerAdapter);
  });

  it("falls back to the local demo scanner outside production", () => {
    expect(selectVirusScanner({ NODE_ENV: "development" })).toBeInstanceOf(
      LocalDemoVirusScannerAdapter,
    );
    expect(selectVirusScanner({ NODE_ENV: "test" })).toBeInstanceOf(LocalDemoVirusScannerAdapter);
    expect(selectVirusScanner({ NODE_ENV: undefined })).toBeInstanceOf(
      LocalDemoVirusScannerAdapter,
    );
  });

  it("refuses the demo fallback in production", () => {
    expect(() => selectVirusScanner({ NODE_ENV: "production" })).toThrow("CLAMAV_HOST");
  });

  it("defaults to the demo scanner in non-production dependencies", () => {
    const deps = defaultDependencies();
    expect(deps.virusScanner).toBeInstanceOf(LocalDemoVirusScannerAdapter);
  });

  it("refuses production default dependencies without CLAMAV_HOST", async () => {
    const sql = createSql("postgres://postgres:pw@localhost:55432/postgres");
    withEnv(
      {
        NODE_ENV: "production",
        CLAMAV_HOST: undefined,
        PAYEE_FINGERPRINT_SALT: "s".repeat(32),
        WEBAUTHN_RP_ID: "yen.example",
        WEBAUTHN_ORIGIN: "https://yen.example",
      },
      () => {
        expect(() =>
          defaultDependencies(
            Date.now,
            new InMemoryExpenseStore(),
            new PostgresEvidenceStore(sql),
            durableStorage,
          ),
        ).toThrow("Production requires CLAMAV_HOST");
      },
    );
    await sql.end();
  });
});
