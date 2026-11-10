import { pathToFileURL } from "node:url";
import { createSql } from "@yen/db";
import { z } from "zod";

// Status probe for a Yen deployment: checks API liveness and readiness,
// database readiness and the public fund page, then prints one JSON payload
// for status page consumption.
//
// Configuration (all via environment variables):
// - STATUS_API_URL: API base URL, probes GET /health and GET /ready
//   (defaults to http://127.0.0.1:3001, the local development API)
// - STATUS_DATABASE_URL: PostgreSQL connection URL for the database check
// - STATUS_PUBLIC_PAGE_URL: public fund page URL, any 2xx passes
// - STATUS_TIMEOUT_MS: per check timeout in milliseconds (default 5000)
// - STATUS_SELF_TEST: "true" validates this script's payload schema offline
//   without any network or database access, for CI use
//
// Exit code is 1 when the overall status is "down", otherwise 0.

const STATUS_SCHEMA_VERSION = "yen.status.v1";

const CHECK_NAMES = ["api_liveness", "api_readiness", "database", "public_page"] as const;

export const statusCheckSchema = z.object({
  name: z.enum(CHECK_NAMES),
  status: z.enum(["ok", "fail", "skipped"]),
  target: z.string().max(2000).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  detail: z.string().max(500).optional(),
});

export const statusPayloadSchema = z.object({
  schema: z.literal(STATUS_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  overall: z.enum(["ok", "degraded", "down"]),
  checks: z.array(statusCheckSchema),
});

export type StatusCheckName = (typeof CHECK_NAMES)[number];
export type StatusCheck = z.output<typeof statusCheckSchema>;
export type StatusPayload = z.output<typeof statusPayloadSchema>;
export type StatusCheckStatus = StatusCheck["status"];
export type StatusOverall = StatusPayload["overall"];

export const configSchema = z.object({
  STATUS_API_URL: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .optional(),
  STATUS_DATABASE_URL: z.url().optional(),
  STATUS_PUBLIC_PAGE_URL: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .optional(),
  STATUS_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  STATUS_SELF_TEST: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

export type StatusProbeConfig = z.output<typeof configSchema>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type DatabaseProbe = (url: string) => Promise<void>;

function truncate(value: string, limit = 500): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function buildCheck(
  name: StatusCheckName,
  status: StatusCheckStatus,
  options: { target?: string; latencyMs?: number; detail?: string } = {},
): StatusCheck {
  const check: StatusCheck = { name, status };
  if (options.target !== undefined) check.target = options.target;
  if (options.latencyMs !== undefined) check.latencyMs = options.latencyMs;
  if (options.detail !== undefined) check.detail = truncate(options.detail);
  return check;
}

/**
 * "down" when the money path surface fails: the API process or the database.
 * "degraded" when only auxiliary surfaces fail or nothing is configured.
 */
export function determineOverall(checks: readonly StatusCheck[]): StatusOverall {
  const hardFailures = new Set<StatusCheckName>(["api_liveness", "database"]);
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.some((check) => hardFailures.has(check.name))) return "down";
  if (failed.length > 0) return "degraded";
  if (checks.every((check) => check.status === "skipped")) return "degraded";
  return "ok";
}

async function httpCheck(
  name: StatusCheckName,
  url: string,
  timeoutMs: number,
  fetchLike: FetchLike,
): Promise<StatusCheck> {
  const startedAt = Date.now();
  try {
    const response = await fetchLike(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      return buildCheck(name, "fail", {
        target: url,
        latencyMs,
        detail: `HTTP ${response.status}`,
      });
    }
    return buildCheck(name, "ok", { target: url, latencyMs });
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return buildCheck(name, "fail", {
      target: url,
      latencyMs,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const databaseProbe: DatabaseProbe = async (url) => {
  const parsed = new URL(url);
  if (!parsed.protocol.startsWith("postgres")) {
    throw new Error("STATUS_DATABASE_URL must be a postgres:// or postgresql:// URL");
  }
  const sql = createSql(url, { max: 1, connectTimeout: 5 });
  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end({ timeout: 2 });
  }
};

async function databaseCheck(url: string, probe: DatabaseProbe): Promise<StatusCheck> {
  const target = new URL(url).host;
  const startedAt = Date.now();
  try {
    await probe(url);
    return buildCheck("database", "ok", {
      target,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    return buildCheck("database", "fail", {
      target,
      latencyMs: Math.max(0, Date.now() - startedAt),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Offline CI mode: validates the payload schema against a representative payload. */
export function buildSelfTestPayload(now = new Date()): StatusPayload {
  const payload: StatusPayload = {
    schema: STATUS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    overall: "degraded",
    checks: [
      buildCheck("api_liveness", "ok", { target: "self-test", latencyMs: 1 }),
      buildCheck("api_readiness", "fail", {
        target: "self-test",
        latencyMs: 1,
        detail: "synthetic failure for schema validation",
      }),
      buildCheck("database", "skipped"),
      buildCheck("public_page", "skipped"),
    ],
  };
  return statusPayloadSchema.parse(payload);
}

export async function collectStatus(
  config: StatusProbeConfig,
  fetchLike: FetchLike = fetch,
  probeDatabase: DatabaseProbe = databaseProbe,
): Promise<StatusPayload> {
  const checks: StatusCheck[] = [];
  const apiUrl = config.STATUS_API_URL ?? "http://127.0.0.1:3001";
  checks.push(
    await httpCheck("api_liveness", `${apiUrl}/health`, config.STATUS_TIMEOUT_MS, fetchLike),
  );
  checks.push(
    await httpCheck("api_readiness", `${apiUrl}/ready`, config.STATUS_TIMEOUT_MS, fetchLike),
  );
  checks.push(
    config.STATUS_DATABASE_URL === undefined
      ? buildCheck("database", "skipped")
      : await databaseCheck(config.STATUS_DATABASE_URL, probeDatabase),
  );
  checks.push(
    config.STATUS_PUBLIC_PAGE_URL === undefined
      ? buildCheck("public_page", "skipped")
      : await httpCheck(
          "public_page",
          config.STATUS_PUBLIC_PAGE_URL,
          config.STATUS_TIMEOUT_MS,
          fetchLike,
        ),
  );
  const payload: StatusPayload = {
    schema: STATUS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    overall: determineOverall(checks),
    checks,
  };
  return statusPayloadSchema.parse(payload);
}

export function renderPayload(payload: StatusPayload): string {
  return JSON.stringify(payload, null, 2);
}

async function main(): Promise<void> {
  const config = configSchema.parse(process.env);
  const payload = config.STATUS_SELF_TEST ? buildSelfTestPayload() : await collectStatus(config);
  process.stdout.write(`${renderPayload(payload)}\n`);
  if (payload.overall === "down") process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `check-status failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
