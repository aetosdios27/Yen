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

databaseSuite("append fault ownership", (sql) => {
  it("caller validation and missing fund are good; stored-head corruption is bad", async () => {
    await migrate(sql);
    const user = uuidv7(),
      org = orgIdSchema.parse(uuidv7()),
      fund = fundIdSchema.parse(uuidv7());
    await sql`INSERT INTO users(id, phone, display_name) VALUES (${user}, '+919999888877','Fixture')`;
    await sql`INSERT INTO orgs(id, name, legal_form, owner_id) VALUES (${org},'Fixture','society',${user})`;
    await sql`INSERT INTO funds(id,org_id,title,policy_json) VALUES (${fund},${org},'Fixture','{}')`;
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const meter = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
    });
    metrics.disable();
    metrics.setGlobalMeterProvider(meter);
    const input = {
      fundId: fund,
      type: "fund.created" as const,
      version: 1 as const,
      actor: pseudonymIdSchema.parse(`psn_${user}`),
      occurredAt: new Date().toISOString(),
      payload: { org_id: org, visibility: "private" as const },
    };
    try {
      await expect(appendEvent(sql, { ...input, occurredAt: "invalid" })).rejects.toThrow();
      await expect(
        appendEvent(sql, { ...input, fundId: fundIdSchema.parse(uuidv7()) }),
      ).rejects.toThrow();
      await sql`ALTER TABLE fund_events DISABLE TRIGGER fund_events_before_insert`;
      await sql`INSERT INTO fund_events VALUES (${fund},1,'fund.created',1,${input.actor},${input.occurredAt},'{}',repeat('0',64),repeat('0',64),'{}')`;
      await sql`ALTER TABLE fund_events ENABLE TRIGGER fund_events_before_insert`;
      await expect(appendEvent(sql, input)).rejects.toThrow(TypeError);
      await meter.forceFlush();
      const points = exporter
        .getMetrics()
        .flatMap((b) =>
          b.scopeMetrics.flatMap((s) =>
            s.metrics
              .filter((m) => m.descriptor.name === "yen.slo.observations")
              .flatMap((m) =>
                m.dataPoints.map((p) => ({ attributes: p.attributes, value: p.value })),
              ),
          ),
        );
      for (const [good, value] of [
        [true, 2],
        [false, 1],
      ])
        expect(points).toContainEqual(
          expect.objectContaining({
            attributes: { "yen.slo.id": "event_append", "yen.slo.good": good },
            value,
          }),
        );
    } finally {
      await meter.shutdown();
    }
  });
});
