import type { Server } from "node:http";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createSql, ensureFundPseudonym, type Sql } from "@yen/db";
import { createApp } from "./app.js";
import { createOtpDeliveryProvider, PostgresAuthStore } from "./auth/index.js";
import { type CleanupScheduler, startCleanupScheduler } from "./cleanup-scheduler.js";
import { createClientIpResolver, type TrustedProxyHeader } from "./client-ip.js";
import { rateLimits } from "./config.js";
import { createDatabaseReady } from "./database-ready.js";
import { DefaultInFlightTracker } from "./dependencies.js";
import { PostgresDisplayNameStore } from "./display-name-store.js";
import { PostgresDonationPledgeStore } from "./donation-store.js";
import { PostgresEvidenceStore } from "./evidence-store-postgres.js";
import { PostgresExpenseStore } from "./expense-store.js";
import { FileSystemStorageAdapter } from "./filesystem-storage.js";
import { PostgresFundStore } from "./fund-store.js";
import { createServerLifecycle, type ServerLifecycle, shutdownOnSignal } from "./lifecycle.js";
import { startObservability } from "./observability.js";
import { PostgresPinStore } from "./pin/index.js";
import { PostgresReconciliationStore } from "./reconciliation/postgres-store.js";
import { useMemoryStore } from "./server-config.js";
import {
  MemoryRateLimitStore,
  PostgresIdempotencyStore,
  PostgresRateLimitStore,
} from "./stores.js";
import { ClamAvVirusScannerAdapter } from "./virus-scanner.js";
import { PostgresWaitlistStore } from "./waitlist-store.js";

export interface ServerConfig {
  readonly NODE_ENV: "development" | "test" | "production";
  readonly PORT: number;
  readonly CLAMAV_HOST?: string | undefined;
  readonly CLAMAV_PORT?: number | undefined;
  readonly CLAMAV_TIMEOUT_MS?: number | undefined;
  readonly CLAMAV_MAX_SIZE_BYTES?: number | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly EVIDENCE_STORAGE_DIR?: string | undefined;
  readonly OTP_HASH_KEY?: string | undefined;
  readonly PARTNER_WEBHOOK_SECRET?: string | undefined;
  readonly YEN_ALLOW_MEMORY_STORES?: "true" | "false" | undefined;
  readonly READINESS_CACHE_MS: number;
  readonly TRUSTED_PROXY_HOPS: number;
  readonly TRUSTED_PROXY_HEADER: TrustedProxyHeader;
  readonly CLEANUP_INTERVAL_MS: number;
  readonly WAITLIST_MIN_RESPONSE_MS: number;
  readonly PLEDGE_RATE_LIMIT_CAPACITY?: number;
  readonly PLEDGE_RATE_LIMIT_REFILL_MS?: number;
  readonly PLEDGE_BODY_LIMIT_BYTES?: number;
  readonly WAITLIST_RATE_LIMIT_CAPACITY: number;
  readonly WAITLIST_RATE_LIMIT_REFILL_MS: number;
  readonly WAITLIST_BODY_LIMIT_BYTES: number;
  readonly RATE_LIMIT_MAX_KEYS: number;
  readonly RATE_LIMIT_IP_CAPACITY: number;
  readonly RATE_LIMIT_PRINCIPAL_CAPACITY: number;
  readonly RATE_LIMIT_REFILL_MS: number;
  readonly DATABASE_POOL_MAX: number;
  readonly DATABASE_POOL_IDLE_TIMEOUT_SECONDS: number;
  readonly DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS: number;
  readonly CONCURRENCY_LIMIT: number;
  readonly REQUEST_TIMEOUT_MS: number;
  readonly SHUTDOWN_TIMEOUT_MS: number;
  readonly SERVER_HEADERS_TIMEOUT_MS: number;
  readonly SERVER_REQUEST_TIMEOUT_MS: number;
  readonly SERVER_KEEP_ALIVE_TIMEOUT_MS: number;
  readonly SERVER_MAX_HEADER_SIZE_BYTES: number;
}

export interface StartedServer {
  readonly app: ReturnType<typeof createApp>;
  readonly server: Server;
  readonly sql?: Sql | undefined;
  readonly cleanup?: CleanupScheduler | undefined;
  readonly lifecycle: ServerLifecycle;
  readonly inFlightTracker: DefaultInFlightTracker;
  readonly port: number;
}

export async function startServer(
  config?: ServerConfig,
  options: { readonly registerSignals?: boolean } = {},
): Promise<StartedServer> {
  const resolvedConfig = config ?? (await import("./env.js")).env;
  const memory = useMemoryStore(resolvedConfig);
  if (resolvedConfig.NODE_ENV === "production" && !resolvedConfig.DATABASE_URL) {
    throw new Error("Production API requires DATABASE_URL and a PostgreSQL fund store");
  }
  const sql = resolvedConfig.DATABASE_URL
    ? createSql(resolvedConfig.DATABASE_URL, {
        max: resolvedConfig.DATABASE_POOL_MAX,
        idleTimeout: resolvedConfig.DATABASE_POOL_IDLE_TIMEOUT_SECONDS,
        connectTimeout: resolvedConfig.DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS,
      })
    : undefined;

  const evidenceStorageDirectory =
    resolvedConfig.EVIDENCE_STORAGE_DIR ??
    (resolvedConfig.NODE_ENV === "development" ? resolve(".data/evidence") : undefined);
  if (resolvedConfig.NODE_ENV !== "test" && !sql) {
    throw new Error("A PostgreSQL database is required for durable evidence storage");
  }
  if (resolvedConfig.NODE_ENV !== "test" && !evidenceStorageDirectory) {
    throw new Error("EVIDENCE_STORAGE_DIR is required for durable evidence storage");
  }
  const evidenceStorage = evidenceStorageDirectory
    ? await FileSystemStorageAdapter.open(evidenceStorageDirectory)
    : undefined;

  if (memory) {
    process.stderr.write(
      "WARNING: waitlist uses volatile in-memory storage; data will be lost on restart\n",
    );
  }

  const databaseUrl = resolvedConfig.DATABASE_URL;
  const readiness = databaseUrl
    ? createDatabaseReady(
        () =>
          createSql(databaseUrl, {
            max: 1,
            connectTimeout: Math.min(2, resolvedConfig.DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS),
            idleTimeout: 2,
          }),
        { cacheMs: resolvedConfig.READINESS_CACHE_MS },
      )
    : () => Promise.resolve(memory);

  if (!(await readiness())) {
    await sql?.end({ timeout: 1 });
    throw new Error("DATABASE_URL connection failed or waitlist_entries table is unavailable");
  }
  const telemetrySdk = await startObservability();

  const inFlightTracker = new DefaultInFlightTracker();
  let lifecycleInstance: ServerLifecycle | undefined;

  const postgresStores = sql
    ? {
        waitlistStore: new PostgresWaitlistStore(sql),
        idempotencyStore: new PostgresIdempotencyStore(sql),
        rateLimitStore: new PostgresRateLimitStore(sql, {
          maxEntries: resolvedConfig.RATE_LIMIT_MAX_KEYS,
        }),
      }
    : undefined;

  // Memory stores reclaim expired entries themselves; only the shared Postgres tables grow.
  const cleanup = postgresStores
    ? startCleanupScheduler(
        [
          {
            name: "idempotency_keys",
            run: (now, limit) => postgresStores.idempotencyStore.sweep(now, limit),
          },
          {
            name: "rate_limits",
            run: (now, limit) => postgresStores.rateLimitStore.prune(now, limit),
          },
        ],
        {
          intervalMs: resolvedConfig.CLEANUP_INTERVAL_MS,
          onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
        },
      )
    : undefined;

  const app = createApp({
    ...(resolvedConfig.CLAMAV_HOST
      ? {
          virusScanner: new ClamAvVirusScannerAdapter({
            host: resolvedConfig.CLAMAV_HOST,
            port: resolvedConfig.CLAMAV_PORT ?? 3310,
            timeoutMs: resolvedConfig.CLAMAV_TIMEOUT_MS ?? 10000,
            maxSizeBytes: resolvedConfig.CLAMAV_MAX_SIZE_BYTES ?? 10 * 1024 * 1024,
          }),
        }
      : {}),
    isShuttingDown: () => lifecycleInstance?.isShuttingDown ?? false,
    ...(sql ? { donationPledgeStore: new PostgresDonationPledgeStore(sql) } : {}),
    ...(sql ? { reconciliationStore: new PostgresReconciliationStore(sql) } : {}),
    ...(sql ? { displayNameStore: new PostgresDisplayNameStore(sql) } : {}),
    ...(sql ? { expenseStore: new PostgresExpenseStore(sql) } : {}),
    ...(sql ? { fundStore: new PostgresFundStore(sql) } : {}),
    ...(sql && evidenceStorage
      ? {
          evidenceStore: new PostgresEvidenceStore(sql),
          storageAdapter: evidenceStorage,
        }
      : {}),
    ...(sql
      ? {
          actorForUser: (userId: string, fundId: string) =>
            ensureFundPseudonym(sql, { userId, fundId }),
        }
      : {}),
    pledgeLimit: {
      capacity: resolvedConfig.PLEDGE_RATE_LIMIT_CAPACITY ?? 10,
      refillMs: resolvedConfig.PLEDGE_RATE_LIMIT_REFILL_MS ?? 3_600_000,
    },
    pledgeBodyLimit: resolvedConfig.PLEDGE_BODY_LIMIT_BYTES ?? 4096,
    ...(postgresStores ?? {
      rateLimitStore: new MemoryRateLimitStore({
        maxEntries: resolvedConfig.RATE_LIMIT_MAX_KEYS,
      }),
    }),
    ...(sql ? { authStore: new PostgresAuthStore(sql) } : {}),
    ...(sql ? { pinStore: new PostgresPinStore(sql) } : {}),
    otpHashKey: resolvedConfig.OTP_HASH_KEY ?? "development-only-otp-hash-key-change-me",
    partnerWebhookSecret: resolvedConfig.PARTNER_WEBHOOK_SECRET ?? null,
    otpDeliveryProvider: createOtpDeliveryProvider(resolvedConfig.NODE_ENV),
    waitlistLimit: {
      capacity: resolvedConfig.WAITLIST_RATE_LIMIT_CAPACITY,
      refillMs: resolvedConfig.WAITLIST_RATE_LIMIT_REFILL_MS,
    },
    readiness,
    waitlistMinResponseMs: resolvedConfig.WAITLIST_MIN_RESPONSE_MS,
    waitlistBodyLimit: resolvedConfig.WAITLIST_BODY_LIMIT_BYTES,
    concurrencyLimit: resolvedConfig.CONCURRENCY_LIMIT,
    requestTimeoutMs: resolvedConfig.REQUEST_TIMEOUT_MS,
    inFlightTracker,
    clientIp: createClientIpResolver({
      trustedHops: resolvedConfig.TRUSTED_PROXY_HOPS,
      trustedHeader: resolvedConfig.TRUSTED_PROXY_HEADER,
    }),
    rateLimits: rateLimits({
      ...resolvedConfig,
      PLEDGE_RATE_LIMIT_CAPACITY: resolvedConfig.PLEDGE_RATE_LIMIT_CAPACITY ?? 10,
      PLEDGE_RATE_LIMIT_REFILL_MS: resolvedConfig.PLEDGE_RATE_LIMIT_REFILL_MS ?? 3_600_000,
      PLEDGE_BODY_LIMIT_BYTES: resolvedConfig.PLEDGE_BODY_LIMIT_BYTES ?? 4096,
    }),
  });

  const server = serve({
    fetch: app.fetch,
    port: resolvedConfig.PORT,
    serverOptions: {
      maxHeaderSize: resolvedConfig.SERVER_MAX_HEADER_SIZE_BYTES,
    },
  }) as Server;

  // Node HTTP server tuning:
  // - headersTimeout: time parser waits for complete headers
  //   Primary doc: https://nodejs.org/api/http.html#serverheaderstimeout
  // - requestTimeout: time server waits for complete request
  //   Primary doc: https://nodejs.org/api/http.html#serverrequesttimeout
  // - keepAliveTimeout: inactivity time before destroying idle keep-alive socket
  //   Primary doc: https://nodejs.org/api/http.html#serverkeepalivetimeout
  // - maxHeaderSize: maximum HTTP headers size in bytes
  //   Primary doc: https://nodejs.org/api/http.html#servermaxheadersize
  server.headersTimeout = resolvedConfig.SERVER_HEADERS_TIMEOUT_MS;
  server.requestTimeout = resolvedConfig.SERVER_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = resolvedConfig.SERVER_KEEP_ALIVE_TIMEOUT_MS;
  (server as unknown as { maxHeaderSize?: number }).maxHeaderSize =
    resolvedConfig.SERVER_MAX_HEADER_SIZE_BYTES;

  const baseLifecycle = createServerLifecycle({
    server,
    sql,
    cleanup,
    getInFlight: () => inFlightTracker.count,
    shutdownTimeoutMs: resolvedConfig.SHUTDOWN_TIMEOUT_MS,
  });
  const lifecycle: ServerLifecycle = {
    get isShuttingDown() {
      return baseLifecycle.isShuttingDown;
    },
    async shutdown(signal) {
      try {
        await baseLifecycle.shutdown(signal);
      } finally {
        await telemetrySdk?.shutdown();
      }
    },
  };
  lifecycleInstance = lifecycle;

  if (options.registerSignals ?? true) {
    let shuttingDown = false;
    const handleSignal = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        process.exit(1);
      }
      shuttingDown = true;
      void shutdownOnSignal(lifecycle, signal, (code) => process.exit(code));
    };
    process.on("SIGTERM", () => handleSignal("SIGTERM"));
    process.on("SIGINT", () => handleSignal("SIGINT"));
  }

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : resolvedConfig.PORT;

  return {
    app,
    server,
    sql,
    cleanup,
    lifecycle,
    inFlightTracker,
    port: actualPort,
  };
}
