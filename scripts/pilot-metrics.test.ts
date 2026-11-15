import { describe, expect, it } from "vitest";
import {
  type ApprovalTurnaroundRow,
  approvalTurnaroundSql,
  buildSelfTestPayload,
  collectMetrics,
  computeApprovalTurnaround,
  computeDonationConversion,
  computeTimeToFirstFund,
  configSchema,
  type DonationStatusRow,
  type DonationVerificationTimeRow,
  donationStatusSql,
  donationVerificationTimeSql,
  type MetricsQueryRunner,
  metricsPayloadSchema,
  percentile,
  renderDatabaseTarget,
  renderPayload,
  renderTable,
  resolveDatabaseUrl,
  round1,
  type TimeToFirstFundRow,
  timeToFirstFundSql,
} from "./pilot-metrics.js";

const ms = (iso: string) => new Date(iso).getTime();
const iso = (epochMs: number) => new Date(epochMs).toISOString();

const config = configSchema.parse({
  YEN_TEST_DATABASE_URL: "postgres://user:secret@db.test:5432/yen",
  PILOT_METRICS_FORMAT: "json",
});

function fakeRunner(rows: {
  timeToFirstFund?: TimeToFirstFundRow[];
  approvalTurnaround?: ApprovalTurnaroundRow[];
  donationStatuses?: DonationStatusRow[];
  donationVerificationTimes?: DonationVerificationTimeRow[];
}): MetricsQueryRunner {
  return {
    runTimeToFirstFund: async () => rows.timeToFirstFund ?? [],
    runApprovalTurnaround: async () => rows.approvalTurnaround ?? [],
    runDonationStatuses: async () => rows.donationStatuses ?? [],
    runDonationVerificationTimes: async () => rows.donationVerificationTimes ?? [],
    end: async () => {},
  };
}

describe("query strings", () => {
  const readOnly = [
    timeToFirstFundSql,
    approvalTurnaroundSql,
    donationStatusSql,
    donationVerificationTimeSql,
  ];

  it("never contains a write statement", () => {
    for (const sql of readOnly) {
      expect(sql).toMatch(/^\s*SELECT/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i);
    }
  });

  it("joins org owner and first fund for onboarding speed", () => {
    expect(timeToFirstFundSql).toContain("FROM orgs");
    expect(timeToFirstFundSql).toContain("JOIN users u ON u.id = o.owner_id");
    expect(timeToFirstFundSql).toContain("LEFT JOIN funds f ON f.org_id = o.id");
    expect(timeToFirstFundSql).toContain("MIN(f.created_at)");
  });

  it("measures approval turnaround from the expense_data document", () => {
    expect(approvalTurnaroundSql).toContain("FROM expenses e");
    expect(approvalTurnaroundSql).toContain("e.expense_data->>'submittedAt'");
    expect(approvalTurnaroundSql).toContain("e.expense_data->>'approvedAt'");
    expect(approvalTurnaroundSql).toContain("('approved', 'paid', 'reconciled')");
  });

  it("counts donation pledges per status and lags verified ones", () => {
    expect(donationStatusSql).toContain("FROM donation_pledges");
    expect(donationStatusSql).toContain("GROUP BY status");
    expect(donationVerificationTimeSql).toContain("status = 'verified'");
    expect(donationVerificationTimeSql).toContain("verified_at IS NOT NULL");
  });
});

describe("resolveDatabaseUrl", () => {
  it("prefers YEN_TEST_DATABASE_URL over DATABASE_URL", () => {
    const parsed = resolveDatabaseUrl(
      configSchema.parse({
        YEN_TEST_DATABASE_URL: "postgres://u:test@h1:5432/a",
        DATABASE_URL: "postgres://u:prod@h2:5432/b",
      }),
    );
    expect(parsed).toBe("postgres://u:test@h1:5432/a");
  });

  it("falls back to DATABASE_URL", () => {
    expect(resolveDatabaseUrl(configSchema.parse({ DATABASE_URL: "postgres://u@h2:5432/b" }))).toBe(
      "postgres://u@h2:5432/b",
    );
  });

  it("returns null when nothing is configured", () => {
    expect(resolveDatabaseUrl(configSchema.parse({}))).toBeNull();
  });

  it("rejects a non-postgres URL", () => {
    expect(() =>
      resolveDatabaseUrl(configSchema.parse({ DATABASE_URL: "mysql://u@h:3306/x" })),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("renderDatabaseTarget", () => {
  it("shows host and database name without credentials", () => {
    expect(renderDatabaseTarget("postgres://user:secret@db.test:5432/yen")).toBe(
      "db.test:5432/yen",
    );
    expect(renderDatabaseTarget("postgres://user:secret@db.test:5432/yen")).not.toContain("secret");
    expect(renderDatabaseTarget("postgres://user:secret@db.test:5432/yen")).not.toContain("user");
  });
});

describe("percentile", () => {
  it("returns null for an empty list", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("returns the single element unchanged", () => {
    expect(percentile([7], 90)).toBe(7);
  });

  it("returns exact members for odd counts", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6);
  });

  it("interpolates for even counts", () => {
    expect(percentile([10, 20], 50)).toBe(15);
  });
});

describe("round1", () => {
  it("keeps one decimal", () => {
    expect(round1(12.34)).toBe(12.3);
    expect(round1(1 / 3)).toBe(0.3);
  });
});

describe("computeTimeToFirstFund", () => {
  const owner = iso(ms("2026-11-01T09:00:00.000Z"));

  it("measures minutes from owner setup to first fund", () => {
    const summary = computeTimeToFirstFund([
      {
        org_id: "org-1",
        org_name: "Robotics Club",
        owner_setup_at: owner,
        first_fund_at: iso(ms(owner) + 45 * 60000),
      },
    ]);
    expect(summary.clubsTotal).toBe(1);
    expect(summary.clubsWithFund).toBe(1);
    expect(summary.timeToFirstFund.p50Minutes).toBe(45);
    expect(summary.perClub[0]).toMatchObject({
      orgId: "org-1",
      hasFund: true,
      minutesToFirstFund: 45,
    });
  });

  it("reports clubs without a fund as hasFund false with null minutes", () => {
    const summary = computeTimeToFirstFund([
      { org_id: "org-2", org_name: "Drama Club", owner_setup_at: owner, first_fund_at: null },
    ]);
    expect(summary.clubsWithFund).toBe(0);
    expect(summary.timeToFirstFund.measuredClubs).toBe(0);
    expect(summary.timeToFirstFund.p50Minutes).toBeNull();
    expect(summary.perClub[0]?.hasFund).toBe(false);
    expect(summary.perClub[0]?.minutesToFirstFund).toBeNull();
  });

  it("skips rows where the fund predates the owner account", () => {
    const summary = computeTimeToFirstFund([
      {
        org_id: "org-3",
        org_name: "Backwards Club",
        owner_setup_at: iso(ms(owner) + 60000),
        first_fund_at: owner,
      },
    ]);
    expect(summary.skippedInvalid).toBe(1);
    expect(summary.clubsTotal).toBe(0);
    expect(summary.clubsWithFund).toBe(0);
  });

  it("skips unparseable timestamps without throwing", () => {
    const summary = computeTimeToFirstFund([
      {
        org_id: "org-4",
        org_name: "Broken Club",
        owner_setup_at: "not-a-date",
        first_fund_at: null,
      },
    ]);
    expect(summary.skippedInvalid).toBe(1);
    expect(summary.perClub).toHaveLength(0);
  });

  it("accepts Date objects like postgres.js returns", () => {
    const summary = computeTimeToFirstFund([
      {
        org_id: "org-5",
        org_name: "Date Club",
        owner_setup_at: new Date(ms(owner)),
        first_fund_at: new Date(ms(owner) + 90 * 60000),
      },
    ]);
    expect(summary.timeToFirstFund.p50Minutes).toBe(90);
  });

  it("computes p90 across several clubs", () => {
    const rows = [10, 20, 30, 40].map((minutes, i) => ({
      org_id: `org-${i}`,
      org_name: `Club ${i}`,
      owner_setup_at: owner,
      first_fund_at: iso(ms(owner) + minutes * 60000),
    }));
    const summary = computeTimeToFirstFund(rows);
    expect(summary.timeToFirstFund.p50Minutes).toBe(25);
    expect(summary.timeToFirstFund.p90Minutes).toBe(37);
    expect(summary.timeToFirstFund.maxMinutes).toBe(40);
  });
});

describe("computeApprovalTurnaround", () => {
  const submitted = ms("2026-11-05T10:00:00.000Z");

  it("measures submitted to approved in hours", () => {
    const summary = computeApprovalTurnaround([
      { submitted_at: iso(submitted), approved_at: iso(submitted + 3 * 3600000) },
    ]);
    expect(summary.decidedExpenses).toBe(1);
    expect(summary.p50Hours).toBe(3);
    expect(summary.within24h).toBe(1);
    expect(summary.within24hRate).toBe(1);
    expect(summary.maxHours).toBe(3);
  });

  it("splits the 24 hour target", () => {
    const summary = computeApprovalTurnaround([
      { submitted_at: iso(submitted), approved_at: iso(submitted + 2 * 3600000) },
      { submitted_at: iso(submitted), approved_at: iso(submitted + 30 * 3600000) },
    ]);
    expect(summary.within24h).toBe(1);
    expect(summary.within24hRate).toBe(0.5);
  });

  it("returns null rates without data", () => {
    const summary = computeApprovalTurnaround([]);
    expect(summary.decidedExpenses).toBe(0);
    expect(summary.within24hRate).toBeNull();
    expect(summary.p50Hours).toBeNull();
  });

  it("skips inverted or unparseable pairs", () => {
    const summary = computeApprovalTurnaround([
      { submitted_at: iso(submitted + 3600000), approved_at: iso(submitted) },
      { submitted_at: "junk", approved_at: iso(submitted) },
    ]);
    expect(summary.skippedInvalid).toBe(2);
    expect(summary.decidedExpenses).toBe(0);
  });
});

describe("computeDonationConversion", () => {
  const statuses: DonationStatusRow[] = [
    { status: "pledged", count: 5 },
    { status: "verified", count: 4 },
    { status: "rejected", count: 1 },
    { status: "refunded", count: 0 },
    { status: "some-future-status", count: 2 },
  ];

  it("counts every status and computes the verified conversion rate", () => {
    const summary = computeDonationConversion(statuses, []);
    expect(summary.total).toBe(12);
    expect(summary.pledged).toBe(5);
    expect(summary.verified).toBe(4);
    expect(summary.rejected).toBe(1);
    expect(summary.refunded).toBe(0);
    expect(summary.conversionRate).toBeCloseTo(4 / 12, 2);
  });

  it("measures the median pledge to verified lag", () => {
    const created = ms("2026-11-06T08:00:00.000Z");
    const summary = computeDonationConversion(statuses, [
      { created_at: iso(created), verified_at: iso(created + 60 * 60000) },
      { created_at: iso(created), verified_at: iso(created + 180 * 60000) },
    ]);
    expect(summary.medianVerificationMinutes).toBe(120);
    expect(summary.verificationLagSample).toBe(2);
  });

  it("returns null conversion on an empty database", () => {
    const summary = computeDonationConversion([], []);
    expect(summary.total).toBe(0);
    expect(summary.conversionRate).toBeNull();
    expect(summary.medianVerificationMinutes).toBeNull();
  });

  it("ignores negative verification lags", () => {
    const created = ms("2026-11-06T08:00:00.000Z");
    const summary = computeDonationConversion(statuses, [
      { created_at: iso(created), verified_at: iso(created - 1000) },
    ]);
    expect(summary.verificationLagSample).toBe(0);
    expect(summary.medianVerificationMinutes).toBeNull();
  });
});

describe("buildMetricsPayload", () => {
  it("emits a payload that satisfies the metrics schema", () => {
    const payload = buildSelfTestPayload(new Date("2026-11-10T00:00:00.000Z"));
    expect(metricsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("carries the schema version and the target hour literal", () => {
    const payload = buildSelfTestPayload();
    expect(payload.schema).toBe("yen.pilot-metrics.v1");
    expect(payload.approvals.targetHours).toBe(24);
  });

  it("round-trips through the rendered JSON", () => {
    const payload = buildSelfTestPayload(new Date("2026-11-10T00:00:00.000Z"));
    expect(JSON.parse(renderPayload(payload))).toEqual(payload);
  });
});

describe("collectMetrics", () => {
  it("collects all three metric families through an injected runner", async () => {
    const owner = ms("2026-11-01T09:00:00.000Z");
    const submitted = ms("2026-11-02T10:00:00.000Z");
    const payload = await collectMetrics(
      config,
      fakeRunner({
        timeToFirstFund: [
          {
            org_id: "org-1",
            org_name: "Robotics Club",
            owner_setup_at: iso(owner),
            first_fund_at: iso(owner + 30 * 60000),
          },
        ],
        approvalTurnaround: [
          { submitted_at: iso(submitted), approved_at: iso(submitted + 5 * 3600000) },
        ],
        donationStatuses: [
          { status: "pledged", count: 3 },
          { status: "verified", count: 1 },
        ],
        donationVerificationTimes: [
          { created_at: iso(submitted), verified_at: iso(submitted + 45 * 60000) },
        ],
      }),
      new Date("2026-11-03T00:00:00.000Z"),
    );
    expect(payload.database).toBe("db.test:5432/yen");
    expect(payload.onboarding.clubsWithFund).toBe(1);
    expect(payload.onboarding.timeToFirstFund.p50Minutes).toBe(30);
    expect(payload.approvals.p50Hours).toBe(5);
    expect(payload.donations.conversionRate).toBe(0.25);
    expect(metricsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("never leaks database credentials into the payload", async () => {
    const payload = await collectMetrics(config, fakeRunner({}));
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload.database).toBe("db.test:5432/yen");
  });
});

describe("renderTable", () => {
  it("renders the headline metrics as one line each", () => {
    const table = renderTable(buildSelfTestPayload(new Date("2026-11-10T00:00:00.000Z")));
    expect(table.split("\n").length).toBeGreaterThan(6);
    expect(table).toContain("Time to first fund p50 / p90 / max");
    expect(table).toContain("Approval within 24h target");
    expect(table).toContain("Donor verification conversion rate");
  });
});
