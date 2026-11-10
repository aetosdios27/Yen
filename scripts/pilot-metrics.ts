import { pathToFileURL } from "node:url";
import { createSql, parseDatabaseUrl } from "@yen/db";
import { z } from "zod";

// Pilot metrics for YEN-51: read-only database queries that measure how the
// pilot club is actually using Yen. Emits one JSON payload (or a small table)
// for the HOD pilot report (docs/pilot/hod-pilot-report-template.md).
//
// Metrics:
// - time to first fund per club: owner account creation -> first fund creation
//   (onboarding speed). The org row and the fund row are created in one
//   transaction, so the owner account timestamp is the honest start point.
// - approval turnaround: expense submittedAt -> approvedAt (quorum reached),
//   target under 24 hours, read from the expense_data JSON document.
// - donor verification conversion: donation pledges -> verified receipts.
//
// Configuration (all via environment variables):
// - YEN_TEST_DATABASE_URL or DATABASE_URL: PostgreSQL connection URL
//   (YEN_TEST_DATABASE_URL wins when both are set)
// - PILOT_METRICS_FORMAT: "json" (default) or "table"
// - PILOT_METRICS_SELF_TEST: "true" validates the payload schema offline
//   without any database access, for CI use
//
// Exit code is 0 on success and 1 when no database URL is configured.

const METRICS_SCHEMA_VERSION = "yen.pilot-metrics.v1";
const APPROVAL_TURNAROUND_TARGET_HOURS = 24;

// Read-only queries against the production schema (packages/db/migrations).
// No parameters, no writes; the guard test asserts the SELECT-only shape.
export const timeToFirstFundSql = `
  SELECT o.id AS org_id,
         o.name AS org_name,
         u.created_at AS owner_setup_at,
         MIN(f.created_at) AS first_fund_at
  FROM orgs o
  JOIN users u ON u.id = o.owner_id
  LEFT JOIN funds f ON f.org_id = o.id
  GROUP BY o.id, o.name, u.created_at
  ORDER BY MIN(f.created_at) ASC NULLS LAST, o.created_at ASC`;

export const approvalTurnaroundSql = `
  SELECT (e.expense_data->>'submittedAt') AS submitted_at,
         (e.expense_data->>'approvedAt') AS approved_at
  FROM expenses e
  WHERE e.status IN ('approved', 'paid', 'reconciled')
    AND e.expense_data->>'submittedAt' IS NOT NULL
    AND e.expense_data->>'approvedAt' IS NOT NULL`;

export const donationStatusSql = `
  SELECT status, COUNT(*)::int AS count
  FROM donation_pledges
  GROUP BY status`;

export const donationVerificationTimeSql = `
  SELECT created_at, verified_at
  FROM donation_pledges
  WHERE status = 'verified'
    AND verified_at IS NOT NULL`;

export interface TimeToFirstFundRow {
  readonly org_id: string;
  readonly org_name: string;
  readonly owner_setup_at: Date | string;
  readonly first_fund_at: Date | string | null;
}

export interface ApprovalTurnaroundRow {
  readonly submitted_at: Date | string;
  readonly approved_at: Date | string;
}

export interface DonationStatusRow {
  readonly status: string;
  readonly count: number | string | bigint;
}

export interface DonationVerificationTimeRow {
  readonly created_at: Date | string;
  readonly verified_at: Date | string;
}

export interface MetricsQueryRunner {
  runTimeToFirstFund(): Promise<TimeToFirstFundRow[]>;
  runApprovalTurnaround(): Promise<ApprovalTurnaroundRow[]>;
  runDonationStatuses(): Promise<DonationStatusRow[]>;
  runDonationVerificationTimes(): Promise<DonationVerificationTimeRow[]>;
  end(): Promise<void>;
}

export function createPostgresRunner(url: string): MetricsQueryRunner {
  const sql = createSql(url, { max: 1, connectTimeout: 5, prepare: false });
  return {
    runTimeToFirstFund: () => sql.unsafe<TimeToFirstFundRow>(timeToFirstFundSql),
    runApprovalTurnaround: () => sql.unsafe<ApprovalTurnaroundRow>(approvalTurnaroundSql),
    runDonationStatuses: () => sql.unsafe<DonationStatusRow>(donationStatusSql),
    runDonationVerificationTimes: () =>
      sql.unsafe<DonationVerificationTimeRow>(donationVerificationTimeSql),
    end: () => sql.end({ timeout: 2 }),
  };
}

export const metricsPayloadSchema = z.object({
  schema: z.literal(METRICS_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  database: z.string().max(200),
  onboarding: z.object({
    clubsTotal: z.number().int().nonnegative(),
    clubsWithFund: z.number().int().nonnegative(),
    skippedInvalid: z.number().int().nonnegative(),
    timeToFirstFund: z.object({
      measuredClubs: z.number().int().nonnegative(),
      p50Minutes: z.number().nullable(),
      p90Minutes: z.number().nullable(),
      maxMinutes: z.number().nullable(),
    }),
    perClub: z.array(
      z.object({
        orgId: z.string(),
        orgName: z.string(),
        hasFund: z.boolean(),
        minutesToFirstFund: z.number().nullable(),
        firstFundAt: z.string().nullable(),
        ownerSetupAt: z.string(),
      }),
    ),
  }),
  approvals: z.object({
    decidedExpenses: z.number().int().nonnegative(),
    skippedInvalid: z.number().int().nonnegative(),
    within24h: z.number().int().nonnegative(),
    within24hRate: z.number().min(0).max(1).nullable(),
    p50Hours: z.number().nullable(),
    p90Hours: z.number().nullable(),
    maxHours: z.number().nullable(),
    targetHours: z.literal(APPROVAL_TURNAROUND_TARGET_HOURS),
  }),
  donations: z.object({
    total: z.number().int().nonnegative(),
    pledged: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    refunded: z.number().int().nonnegative(),
    conversionRate: z.number().min(0).max(1).nullable(),
    medianVerificationMinutes: z.number().nullable(),
    verificationLagSample: z.number().int().nonnegative(),
  }),
});

export type MetricsPayload = z.output<typeof metricsPayloadSchema>;

export const configSchema = z.object({
  YEN_TEST_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PILOT_METRICS_FORMAT: z.enum(["json", "table"]).default("json"),
  PILOT_METRICS_SELF_TEST: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

export type MetricsConfig = z.output<typeof configSchema>;

export function resolveDatabaseUrl(config: MetricsConfig): string | null {
  const raw = config.YEN_TEST_DATABASE_URL || config.DATABASE_URL;
  if (raw === undefined || raw.trim() === "") return null;
  return parseDatabaseUrl(
    raw,
    config.YEN_TEST_DATABASE_URL ? "YEN_TEST_DATABASE_URL" : "DATABASE_URL",
  );
}

/** Database target for display: host and database name only, never credentials. */
export function renderDatabaseTarget(url: string): string {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  return database ? `${parsed.host}/${database}` : parsed.host;
}

function toMillis(value: Date | string): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Linear interpolation percentile over an ascending-sorted list. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface TimeToFirstFundSummary {
  clubsTotal: number;
  clubsWithFund: number;
  skippedInvalid: number;
  timeToFirstFund: MetricsPayload["onboarding"]["timeToFirstFund"];
  perClub: MetricsPayload["onboarding"]["perClub"];
}

export function computeTimeToFirstFund(
  rows: readonly TimeToFirstFundRow[],
): TimeToFirstFundSummary {
  const perClub: MetricsPayload["onboarding"]["perClub"] = [];
  const minutes: number[] = [];
  let skippedInvalid = 0;
  for (const row of rows) {
    const ownerMs = toMillis(row.owner_setup_at);
    if (ownerMs === null) {
      skippedInvalid += 1;
      continue;
    }
    if (row.first_fund_at === null) {
      perClub.push({
        orgId: row.org_id,
        orgName: row.org_name,
        hasFund: false,
        minutesToFirstFund: null,
        firstFundAt: null,
        ownerSetupAt: new Date(ownerMs).toISOString(),
      });
      continue;
    }
    const fundMs = toMillis(row.first_fund_at);
    if (fundMs === null || fundMs < ownerMs) {
      skippedInvalid += 1;
      continue;
    }
    const minutesToFirstFund = round1((fundMs - ownerMs) / 60000);
    minutes.push(minutesToFirstFund);
    perClub.push({
      orgId: row.org_id,
      orgName: row.org_name,
      hasFund: true,
      minutesToFirstFund,
      firstFundAt: new Date(fundMs).toISOString(),
      ownerSetupAt: new Date(ownerMs).toISOString(),
    });
  }
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    clubsTotal: rows.length - skippedInvalid,
    clubsWithFund: minutes.length,
    skippedInvalid,
    timeToFirstFund: {
      measuredClubs: minutes.length,
      p50Minutes: nullableRound(percentile(sorted, 50)),
      p90Minutes: nullableRound(percentile(sorted, 90)),
      maxMinutes: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    },
    perClub,
  };
}

function nullableRound(value: number | null): number | null {
  return value === null ? null : round1(value);
}

export interface ApprovalTurnaroundSummary {
  decidedExpenses: number;
  skippedInvalid: number;
  within24h: number;
  within24hRate: number | null;
  p50Hours: number | null;
  p90Hours: number | null;
  maxHours: number | null;
}

export function computeApprovalTurnaround(
  rows: readonly ApprovalTurnaroundRow[],
): ApprovalTurnaroundSummary {
  const hours: number[] = [];
  let skippedInvalid = 0;
  for (const row of rows) {
    const submittedMs = toMillis(row.submitted_at);
    const approvedMs = toMillis(row.approved_at);
    if (submittedMs === null || approvedMs === null || approvedMs < submittedMs) {
      skippedInvalid += 1;
      continue;
    }
    hours.push((approvedMs - submittedMs) / 3600000);
  }
  const sorted = [...hours].sort((a, b) => a - b);
  const within24h = hours.filter((h) => h <= APPROVAL_TURNAROUND_TARGET_HOURS).length;
  return {
    decidedExpenses: hours.length,
    skippedInvalid,
    within24h,
    within24hRate: hours.length > 0 ? round3(within24h / hours.length) : null,
    p50Hours: nullableRound(percentile(sorted, 50)),
    p90Hours: nullableRound(percentile(sorted, 90)),
    maxHours: sorted.length > 0 ? round1(sorted[sorted.length - 1]) : null,
  };
}

const DONATION_STATUSES = ["pledged", "verified", "rejected", "refunded"] as const;

export interface DonationConversionSummary {
  total: number;
  pledged: number;
  verified: number;
  rejected: number;
  refunded: number;
  conversionRate: number | null;
  medianVerificationMinutes: number | null;
  verificationLagSample: number;
}

export function computeDonationConversion(
  statusRows: readonly DonationStatusRow[],
  verificationRows: readonly DonationVerificationTimeRow[],
): DonationConversionSummary {
  const counts = new Map<string, number>(DONATION_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const row of statusRows) {
    const count = Number(row.count);
    if (!Number.isFinite(count) || count < 0) continue;
    total += count;
    counts.set(row.status, (counts.get(row.status) ?? 0) + count);
  }
  const minutes: number[] = [];
  for (const row of verificationRows) {
    const createdMs = toMillis(row.created_at);
    const verifiedMs = toMillis(row.verified_at);
    if (createdMs === null || verifiedMs === null || verifiedMs < createdMs) continue;
    minutes.push((verifiedMs - createdMs) / 60000);
  }
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    total,
    pledged: counts.get("pledged") ?? 0,
    verified: counts.get("verified") ?? 0,
    rejected: counts.get("rejected") ?? 0,
    refunded: counts.get("refunded") ?? 0,
    conversionRate: total > 0 ? round3((counts.get("verified") ?? 0) / total) : null,
    medianVerificationMinutes: nullableRound(percentile(sorted, 50)),
    verificationLagSample: minutes.length,
  };
}

export function buildMetricsPayload(
  databaseTarget: string,
  onboarding: TimeToFirstFundSummary,
  approvals: ApprovalTurnaroundSummary,
  donations: DonationConversionSummary,
  now = new Date(),
): MetricsPayload {
  return metricsPayloadSchema.parse({
    schema: METRICS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    database: databaseTarget,
    onboarding: {
      clubsTotal: onboarding.clubsTotal,
      clubsWithFund: onboarding.clubsWithFund,
      skippedInvalid: onboarding.skippedInvalid,
      timeToFirstFund: onboarding.timeToFirstFund,
      perClub: onboarding.perClub,
    },
    approvals: { ...approvals, targetHours: APPROVAL_TURNAROUND_TARGET_HOURS },
    donations,
  });
}

/** Offline CI mode: validates the payload schema against a representative payload. */
export function buildSelfTestPayload(now = new Date()): MetricsPayload {
  const onboarding = computeTimeToFirstFund([
    {
      org_id: "00000000-0000-7000-8000-000000000001",
      org_name: "Demo Club",
      owner_setup_at: new Date(now.getTime() - 90 * 60000),
      first_fund_at: now,
    },
  ]);
  const approvals = computeApprovalTurnaround([
    {
      submitted_at: new Date(now.getTime() - 10 * 3600000),
      approved_at: now,
    },
  ]);
  const donations = computeDonationConversion(
    [
      { status: "pledged", count: 2 },
      { status: "verified", count: 3 },
    ],
    [{ created_at: new Date(now.getTime() - 60000), verified_at: now }],
  );
  return buildMetricsPayload("self-test", onboarding, approvals, donations, now);
}

export async function collectMetrics(
  config: MetricsConfig,
  runner: MetricsQueryRunner,
  now = new Date(),
): Promise<MetricsPayload> {
  const [timeToFirstFundRows, approvalRows, donationStatusRows, verificationRows] =
    await Promise.all([
      runner.runTimeToFirstFund(),
      runner.runApprovalTurnaround(),
      runner.runDonationStatuses(),
      runner.runDonationVerificationTimes(),
    ]);
  const databaseUrl = resolveDatabaseUrl(config);
  const target = databaseUrl ? renderDatabaseTarget(databaseUrl) : "unknown";
  return buildMetricsPayload(
    target,
    computeTimeToFirstFund(timeToFirstFundRows),
    computeApprovalTurnaround(approvalRows),
    computeDonationConversion(donationStatusRows, verificationRows),
    now,
  );
}

export function renderPayload(payload: MetricsPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function renderTable(payload: MetricsPayload): string {
  const lines: string[] = [];
  const metric = (label: string, value: string) => {
    lines.push(`${label.padEnd(46)}${value}`);
  };
  const dur = (value: number | null, unit: string) => (value === null ? "-" : `${value} ${unit}`);
  lines.push(`Pilot metrics ${payload.database} (${payload.generatedAt})`);
  metric(
    "Time to first fund (clubs with fund / total)",
    `${payload.onboarding.clubsWithFund}/${payload.onboarding.clubsTotal}`,
  );
  metric(
    "Time to first fund p50 / p90 / max",
    `${dur(payload.onboarding.timeToFirstFund.p50Minutes, "min")} / ${dur(
      payload.onboarding.timeToFirstFund.p90Minutes,
      "min",
    )} / ${dur(payload.onboarding.timeToFirstFund.maxMinutes, "min")}`,
  );
  metric("Approval turnaround decided", `${payload.approvals.decidedExpenses}`);
  metric(
    "Approval turnaround p50 / p90 / max",
    `${dur(payload.approvals.p50Hours, "h")} / ${dur(payload.approvals.p90Hours, "h")} / ${dur(
      payload.approvals.maxHours,
      "h",
    )}`,
  );
  metric(
    `Approval within ${payload.approvals.targetHours}h target`,
    payload.approvals.within24hRate === null
      ? "-"
      : `${payload.approvals.within24h}/${payload.approvals.decidedExpenses} (${payload.approvals.within24hRate})`,
  );
  metric(
    "Donations pledged/verified/rejected/refunded",
    `${payload.donations.pledged} / ${payload.donations.verified} / ${payload.donations.rejected} / ${payload.donations.refunded}`,
  );
  metric(
    "Donor verification conversion rate",
    payload.donations.conversionRate === null
      ? "-"
      : `${payload.donations.conversionRate} of ${payload.donations.total} pledges`,
  );
  metric("Median pledge -> verified lag", dur(payload.donations.medianVerificationMinutes, "min"));
  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = configSchema.parse(process.env);
  if (config.PILOT_METRICS_SELF_TEST) {
    const payload = buildSelfTestPayload();
    process.stdout.write(
      config.PILOT_METRICS_FORMAT === "table"
        ? `${renderTable(payload)}\n`
        : `${renderPayload(payload)}\n`,
    );
    return;
  }
  const databaseUrl = resolveDatabaseUrl(config);
  if (databaseUrl === null) {
    process.stderr.write(
      "pilot-metrics: set YEN_TEST_DATABASE_URL or DATABASE_URL to a PostgreSQL connection URL\n",
    );
    process.exitCode = 1;
    return;
  }
  const runner = createPostgresRunner(databaseUrl);
  try {
    const payload = await collectMetrics(config, runner);
    process.stdout.write(
      config.PILOT_METRICS_FORMAT === "table"
        ? `${renderTable(payload)}\n`
        : `${renderPayload(payload)}\n`,
    );
  } finally {
    await runner.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `pilot-metrics failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
