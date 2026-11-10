import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { appendEvent, migrate, uuidv7 } from "@yen/db";
import { fundIdSchema, orgIdSchema, pseudonymIdSchema } from "@yen/shared";
import { expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { sampleMoneyTelemetry } from "./telemetry.js";

databaseSuite("Outstanding money work telemetry", (sql) => {
  it("counts stale reconciliation work as bad even without completions and exports saturation", async () => {
    await migrate(sql);
    await sql`CREATE SCHEMA telemetry_jobs`;
    await sql`CREATE TABLE telemetry_jobs.job (state text)`;
    await sql`INSERT INTO telemetry_jobs.job VALUES ('retry')`;
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
    });
    metrics.disable();
    metrics.setGlobalMeterProvider(provider);
    try {
      await sampleMoneyTelemetry(sql, "telemetry_jobs");
      await sql`INSERT INTO donation_pledges (id, fund_id, amount_paise, utr, created_at) VALUES (${uuidv7()}, ${uuidv7()}, 100, '987654321012', CURRENT_TIMESTAMP - interval '20 minutes')`;
      const userId = uuidv7();
      const orgId = uuidv7();
      const fundId = fundIdSchema.parse(uuidv7());
      await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, '+919999888877', 'Telemetry fixture')`;
      await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Fixture', 'society', ${userId})`;
      await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fixture', '{}'::jsonb)`;
      await appendEvent(sql, {
        fundId,
        type: "fund.created",
        version: 1,
        actor: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
        occurredAt: new Date(Date.now() - 7200000).toISOString(),
        payload: { org_id: orgIdSchema.parse(orgId), visibility: "private" },
      });
      await sampleMoneyTelemetry(sql, "telemetry_jobs");
      await expect(
        appendEvent(sql, {
          fundId: fundIdSchema.parse(uuidv7()),
          type: "fund.created",
          version: 1,
          actor: pseudonymIdSchema.parse(`psn_${uuidv7()}`),
          occurredAt: new Date().toISOString(),
          payload: { org_id: orgIdSchema.parse(orgId), visibility: "private" },
        }),
      ).rejects.toThrow();
      await provider.forceFlush();
      const all = exporter
        .getMetrics()
        .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics));
      const points = all
        .filter((metric) => metric.descriptor.name === "yen.slo.observations")
        .flatMap((metric) =>
          metric.dataPoints.map((point) => ({ attributes: point.attributes, value: point.value })),
        );
      for (const id of ["reconciliation_lag", "anchor_lag"])
        for (const good of [true, false])
          expect(points).toContainEqual(
            expect.objectContaining({
              attributes: { "yen.slo.id": id, "yen.slo.good": good },
              value: 1,
            }),
          );
      expect(all.map((m) => m.descriptor.name)).toEqual(
        expect.arrayContaining([
          "yen.queue.depth",
          "yen.database.client_connections",
          "yen.append_lock.wait",
        ]),
      );
    } finally {
      await provider.shutdown();
    }
  });
});
