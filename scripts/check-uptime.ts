import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// Uptime probe for a Yen deployment: hits the web home page, API liveness and
// readiness, and one public fund page, then prints one JSON payload for status
// page consumption and alerts a webhook when any probe fails.
//
// Configuration (all via environment variables):
// - UPTIME_WEB_URL: web base URL, probes GET / (defaults to
//   http://127.0.0.1:3000, the local development web app)
// - UPTIME_API_URL: API base URL, probes GET /health and GET /ready and the
//   public fund summary (defaults to http://127.0.0.1:3001)
// - UPTIME_FUND_ID: fund id for the GET /v1/funds/:id/public/summary probe;
//   skipped when unset
// - UPTIME_WEBHOOK_URL: alert webhook; a POST with the failed check summary is
//   sent when any probe fails, skipped when unset
// - UPTIME_TIMEOUT_MS: per probe timeout in milliseconds (default 5000)
// - UPTIME_ALERT_WINDOW_MS: minimum milliseconds between two alerts
//   (default 300000, five minutes)
// - UPTIME_STATE_PATH: file holding the last alert timestamp so repeated runs
//   honor the alert window; without it every failing run alerts
// - UPTIME_SELF_TEST: "true" validates this script's payload schema offline
//   without any network access, for CI use
//
// Exit code is 1 when the overall status is "down", otherwise 0.

const UPTIME_SCHEMA_VERSION = "yen.uptime.v1";

const DEFAULT_ALERT_WINDOW_MS = 5 * 60 * 1000;

const CHECK_NAMES = ["web_home", "api_liveness", "api_readiness", "fund_public_page"] as const;

export const uptimeCheckSchema = z.object({
  name: z.enum(CHECK_NAMES),
  status: z.enum(["ok", "fail", "skipped"]),
  target: z.string().max(2000).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  detail: z.string().max(500).optional(),
});

export const uptimeAlertSchema = z.object({
  dispatched: z.boolean(),
  windowMs: z.number().int().positive(),
  detail: z.string().max(500).optional(),
});

export const uptimePayloadSchema = z.object({
  schema: z.literal(UPTIME_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  overall: z.enum(["up", "degraded", "down"]),
  checks: z.array(uptimeCheckSchema),
  alert: uptimeAlertSchema.optional(),
});

export type UptimeCheckName = (typeof CHECK_NAMES)[number];
export type UptimeCheck = z.output<typeof uptimeCheckSchema>;
export type UptimeAlert = z.output<typeof uptimeAlertSchema>;
export type UptimePayload = z.output<typeof uptimePayloadSchema>;
export type UptimeOverall = UptimePayload["overall"];

export const configSchema = z.object({
  UPTIME_WEB_URL: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .default("http://127.0.0.1:3000"),
  UPTIME_API_URL: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .default("http://127.0.0.1:3001"),
  UPTIME_FUND_ID: z.string().min(1).max(128).optional(),
  UPTIME_WEBHOOK_URL: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .optional(),
  UPTIME_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  UPTIME_ALERT_WINDOW_MS: z.coerce.number().int().positive().default(DEFAULT_ALERT_WINDOW_MS),
  UPTIME_STATE_PATH: z.string().min(1).max(4096).optional(),
  UPTIME_SELF_TEST: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

export type UptimeProbeConfig = z.output<typeof configSchema>;

export type AlertState = { lastAlertAt: number | null };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function truncate(value: string, limit = 500): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function buildCheck(
  name: UptimeCheckName,
  status: UptimeCheck["status"],
  options: { target?: string; latencyMs?: number; detail?: string } = {},
): UptimeCheck {
  const check: UptimeCheck = { name, status };
  if (options.target !== undefined) check.target = options.target;
  if (options.latencyMs !== undefined) check.latencyMs = options.latencyMs;
  if (options.detail !== undefined) check.detail = truncate(options.detail);
  return check;
}

/**
 * "down" when a service surface fails: the web home page or the API process.
 * "degraded" when only the auxiliary public fund page fails or nothing is
 * configured. "up" when every probe passed.
 */
export function determineOverall(checks: readonly UptimeCheck[]): UptimeOverall {
  const hardFailures = new Set<UptimeCheckName>(["web_home", "api_liveness", "api_readiness"]);
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.some((check) => hardFailures.has(check.name))) return "down";
  if (failed.length > 0) return "degraded";
  if (checks.every((check) => check.status === "skipped")) return "degraded";
  return "up";
}

/**
 * The five minute alert window: the first failing run alerts immediately and
 * repeat alerts are suppressed until the window has elapsed since the last
 * dispatched alert. A failed dispatch does not open the window, so the next
 * run retries.
 */
export function shouldSendAlert(
  failing: boolean,
  lastAlertAt: number | null,
  now: number,
  windowMs: number,
): boolean {
  if (!failing) return false;
  if (lastAlertAt === null) return true;
  return now - lastAlertAt >= windowMs;
}

export function readAlertState(path: string): AlertState {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { lastAlertAt?: unknown };
    return {
      lastAlertAt: typeof raw.lastAlertAt === "number" ? raw.lastAlertAt : null,
    };
  } catch {
    return { lastAlertAt: null };
  }
}

export function writeAlertState(path: string, state: AlertState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

async function httpCheck(
  name: UptimeCheckName,
  url: string,
  timeoutMs: number,
  fetchLike: FetchLike,
): Promise<UptimeCheck> {
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

export async function collectUptime(
  config: UptimeProbeConfig,
  fetchLike: FetchLike = fetch,
): Promise<Omit<UptimePayload, "alert">> {
  const checks: UptimeCheck[] = [];
  checks.push(
    await httpCheck("web_home", config.UPTIME_WEB_URL, config.UPTIME_TIMEOUT_MS, fetchLike),
  );
  checks.push(
    await httpCheck(
      "api_liveness",
      `${config.UPTIME_API_URL}/health`,
      config.UPTIME_TIMEOUT_MS,
      fetchLike,
    ),
  );
  checks.push(
    await httpCheck(
      "api_readiness",
      `${config.UPTIME_API_URL}/ready`,
      config.UPTIME_TIMEOUT_MS,
      fetchLike,
    ),
  );
  checks.push(
    config.UPTIME_FUND_ID === undefined
      ? buildCheck("fund_public_page", "skipped")
      : await httpCheck(
          "fund_public_page",
          `${config.UPTIME_API_URL}/v1/funds/${config.UPTIME_FUND_ID}/public/summary`,
          config.UPTIME_TIMEOUT_MS,
          fetchLike,
        ),
  );
  const payload = {
    schema: UPTIME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    overall: determineOverall(checks),
    checks,
  };
  return uptimePayloadSchema.parse(payload);
}

/** Offline CI mode: validates the payload schema against a representative payload. */
export function buildSelfTestPayload(now = new Date()): UptimePayload {
  const payload: UptimePayload = {
    schema: UPTIME_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    overall: "down",
    checks: [
      buildCheck("web_home", "ok", { target: "self-test", latencyMs: 1 }),
      buildCheck("api_liveness", "ok", { target: "self-test", latencyMs: 1 }),
      buildCheck("api_readiness", "fail", {
        target: "self-test",
        latencyMs: 1,
        detail: "synthetic failure for schema validation",
      }),
      buildCheck("fund_public_page", "skipped"),
    ],
    alert: { dispatched: false, windowMs: DEFAULT_ALERT_WINDOW_MS },
  };
  return uptimePayloadSchema.parse(payload);
}

export type AlertWebhookPayload = {
  schema: typeof UPTIME_SCHEMA_VERSION;
  generatedAt: string;
  overall: UptimeOverall;
  failedChecks: { name: UptimeCheckName; target?: string; detail?: string }[];
};

export function buildAlertPayload(payload: UptimePayload): AlertWebhookPayload {
  return {
    schema: UPTIME_SCHEMA_VERSION,
    generatedAt: payload.generatedAt,
    overall: payload.overall,
    failedChecks: payload.checks
      .filter((check) => check.status === "fail")
      .map((check) => ({
        name: check.name,
        ...(check.target === undefined ? {} : { target: check.target }),
        ...(check.detail === undefined ? {} : { detail: check.detail }),
      })),
  };
}

export async function dispatchAlert(
  webhookUrl: string,
  payload: AlertWebhookPayload,
  fetchLike: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function renderPayload(payload: UptimePayload): string {
  return JSON.stringify(payload, null, 2);
}

async function main(): Promise<void> {
  const config = configSchema.parse(process.env);
  if (config.UPTIME_SELF_TEST) {
    const payload = buildSelfTestPayload();
    process.stdout.write(`${renderPayload(payload)}\n`);
    if (payload.overall === "down") process.exitCode = 1;
    return;
  }

  const probed = await collectUptime(config);
  const failing = probed.overall !== "up";
  let alert: UptimeAlert | undefined;
  if (config.UPTIME_WEBHOOK_URL !== undefined) {
    const state =
      config.UPTIME_STATE_PATH === undefined ? null : readAlertState(config.UPTIME_STATE_PATH);
    const now = Date.now();
    const dispatched = await (async () => {
      if (
        !shouldSendAlert(failing, state?.lastAlertAt ?? null, now, config.UPTIME_ALERT_WINDOW_MS)
      ) {
        return false;
      }
      const sent = await dispatchAlert(config.UPTIME_WEBHOOK_URL, buildAlertPayload(probed));
      if (sent && config.UPTIME_STATE_PATH !== undefined) {
        writeAlertState(config.UPTIME_STATE_PATH, { lastAlertAt: now });
      }
      return sent;
    })();
    alert = { dispatched, windowMs: config.UPTIME_ALERT_WINDOW_MS };
  }
  const payload: UptimePayload = uptimePayloadSchema.parse({ ...probed, alert });
  process.stdout.write(`${renderPayload(payload)}\n`);
  if (payload.overall === "down") process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `check-uptime failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
