import { createServer } from "node:http";
import { createSql, ensureFundPseudonym } from "@yen/db";
import { createApp } from "../../../api/dist/app.js";
import { PostgresAuthStore } from "../../../api/dist/auth/stores.js";
import { PostgresDeviceSignatureStore } from "../../../api/dist/device-signature/store.js";
import { PostgresDisplayNameStore } from "../../../api/dist/display-name-store.js";
import { PostgresDonationPledgeStore } from "../../../api/dist/donation-store.js";
import { PostgresEvidenceStore } from "../../../api/dist/evidence-store-postgres.js";
import { PostgresExpenseObjectionStore } from "../../../api/dist/expense-objections.js";
import { PostgresExpenseStore } from "../../../api/dist/expense-store.js";
import { FileSystemStorageAdapter } from "../../../api/dist/filesystem-storage.js";
import { PostgresFundStore } from "../../../api/dist/fund-store.js";
import { PostgresPayeeProfileStore } from "../../../api/dist/payee-rules/profile-store.js";
import { PostgresPinStore } from "../../../api/dist/pin/store.js";
import { devPolicy } from "../../../api/dist/policy.js";
import {
  PostgresIdempotencyStore,
  PostgresRateLimitStore,
} from "../../../api/dist/postgres-stores.js";
import { PostgresPrivacyStore } from "../../../api/dist/privacy-store.js";
import { PostgresPublicFundReadStore } from "../../../api/dist/public-fund-store.js";
import { PostgresReceiptStore } from "../../../api/dist/receipt-store.js";
import { PostgresReconciliationStore } from "../../../api/dist/reconciliation/postgres-store.js";
import { PostgresWaitlistStore } from "../../../api/dist/waitlist-store.js";

/**
 * Real-backend E2E server. Boots the built API app code (createApp) on the
 * Postgres stores the production bootstrap uses, mirroring
 * apps/api/src/server-bootstrap.ts. The one deliberate difference is the
 * policy: the production bootstrap does not wire any policy yet, so its app
 * denies every fund write; this harness wires devPolicy so the journey can
 * exercise the real RBAC engine (devPolicy.can delegates to @yen/policy) with
 * the seeded demo roles. Flagged as an upstream gap in docs/qa.
 */
const port = Number(process.env.E2E_API_PORT ?? 3939);
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("E2E real backend requires E2E_DATABASE_URL\n");
  process.exit(1);
}

const sql = createSql(databaseUrl, { max: 10 });
const evidenceStorage = await FileSystemStorageAdapter.open(
  process.env.EVIDENCE_STORAGE_DIR ?? ".data/evidence",
);
const payeeFingerprintSalt =
  process.env.E2E_PAYEE_FINGERPRINT_SALT ?? "e2e-payee-fingerprint-salt-0123456789";

const app = createApp({
  policy: devPolicy,
  principal: null,
  corsOrigins: [],
  sql,
  donationPledgeStore: new PostgresDonationPledgeStore(sql),
  publicFundReadStore: new PostgresPublicFundReadStore(sql),
  receiptStore: new PostgresReceiptStore(sql),
  displayNameStore: new PostgresDisplayNameStore(sql),
  reconciliationStore: new PostgresReconciliationStore(sql),
  expenseStore: new PostgresExpenseStore(sql),
  fundStore: new PostgresFundStore(sql),
  evidenceStore: new PostgresEvidenceStore(sql),
  storageAdapter: evidenceStorage,
  payeeProfileStore: new PostgresPayeeProfileStore(sql),
  payeeFingerprintSalt,
  objectionStore: new PostgresExpenseObjectionStore(sql),
  actorForUser: (userId, fundId) => ensureFundPseudonym(sql, { userId, fundId }),
  authStore: new PostgresAuthStore(sql),
  privacyStore: new PostgresPrivacyStore(sql),
  pinStore: new PostgresPinStore(sql),
  deviceSignatureStore: new PostgresDeviceSignatureStore(sql),
  waitlistStore: new PostgresWaitlistStore(sql),
  idempotencyStore: new PostgresIdempotencyStore(sql),
  rateLimitStore: new PostgresRateLimitStore(sql, { maxEntries: 100000 }),
  pledgeLimit: { capacity: 1000, refillMs: 1000 },
  rateLimits: {
    ip: { capacity: 5000, refillMs: 60_000 },
    principal: { capacity: 5000, refillMs: 60_000 },
  },
  otpHashKey: process.env.OTP_HASH_KEY ?? "development-only-otp-hash-key-change-me",
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamRequest = new Request(url, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request, duplex: "half" } : {}),
    });
    const upstreamResponse = await app.fetch(upstreamRequest);
    response.writeHead(
      upstreamResponse.status,
      Object.fromEntries(upstreamResponse.headers.entries()),
    );
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch (error) {
    // The response stays generic; handler failures go to stderr so they show
    // up in the Playwright webServer log instead of the browser.
    process.stderr.write(
      `e2e real api handler error: ${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`,
    );
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: { code: "internal" } }));
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`e2e real api (postgres stores, devPolicy) on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    void sql.end({ timeout: 2 });
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
