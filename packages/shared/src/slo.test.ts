import { expect, it } from "vitest";
import { BURN_ALERT_THRESHOLDS, calculateBurnRate, emitBurnRateAlert, SLOS } from "./slo.js";

it("loads typed SLO definitions for each money path", () => {
  expect(SLOS.map(({ id }) => id)).toEqual([
    "approval_api_availability",
    "approve_p95_latency",
    "pay_p95_latency",
    "reconciliation_lag",
    "anchor_lag",
  ]);
  expect(SLOS.every((slo) => slo.windowDays === 30 && slo.objective > 0 && slo.objective < 1)).toBe(
    true,
  );
  expect(BURN_ALERT_THRESHOLDS.page.rate).toBe(14.4);
});

it("computes burn rate and remaining budget over elapsed time", () => {
  const burn = calculateBurnRate(10, 1000, 0.99, 15);
  expect(burn.rate).toBeCloseTo(1);
  expect(burn.remainingBudgetFraction).toBeCloseTo(0.5);
  expect(burn.exhaustedInDays).toBeCloseTo(30);
  expect(calculateBurnRate(0, 1000, 0.99, 5).exhaustedInDays).toBe(Infinity);
  expect(() => calculateBurnRate(2, 1, 0.99, 1)).toThrow(RangeError);
});

it("emits only threshold-crossing burn alerts through the async sink hook", async () => {
  const alerts: unknown[] = [];
  const sink = {
    emit: async (alert: unknown) => {
      alerts.push(alert);
    },
  };
  await emitBurnRateAlert(sink, "approve", 2, 15);
  await emitBurnRateAlert(sink, "approve", 6, 6);
  await emitBurnRateAlert(sink, "pay", 15, 15);
  expect(alerts).toEqual([
    { kind: "slo.burn_rate", sloId: "approve", rate: 6, severity: "ticket" },
    { kind: "slo.burn_rate", sloId: "pay", rate: 15, severity: "page" },
  ]);
});
