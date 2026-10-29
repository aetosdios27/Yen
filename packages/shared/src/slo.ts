export type SloDefinition = {
  readonly id: string;
  readonly indicator: "availability" | "latency" | "lag";
  readonly objective: number;
  readonly windowDays: number;
  readonly threshold?: number;
  readonly unit?: "ms" | "minutes";
};

export const SLOS: readonly SloDefinition[] = [
  { id: "approval_api_availability", indicator: "availability", objective: 0.995, windowDays: 30 },
  {
    id: "approve_p95_latency",
    indicator: "latency",
    objective: 0.95,
    windowDays: 30,
    threshold: 1000,
    unit: "ms",
  },
  {
    id: "pay_p95_latency",
    indicator: "latency",
    objective: 0.95,
    windowDays: 30,
    threshold: 1500,
    unit: "ms",
  },
  {
    id: "reconciliation_lag",
    indicator: "lag",
    objective: 0.99,
    windowDays: 30,
    threshold: 15,
    unit: "minutes",
  },
  {
    id: "anchor_lag",
    indicator: "lag",
    objective: 0.99,
    windowDays: 30,
    threshold: 60,
    unit: "minutes",
  },
];

export type BurnRate = {
  readonly rate: number;
  readonly remainingBudgetFraction: number;
  readonly exhaustedInDays: number;
};

/** Error budget burn rate: observed bad-event ratio divided by allowed bad-event ratio. */
export function calculateBurnRate(
  badEvents: number,
  totalEvents: number,
  objective: number,
  elapsedDays: number,
  windowDays = 30,
): BurnRate {
  if (
    ![badEvents, totalEvents, objective, elapsedDays, windowDays].every(Number.isFinite) ||
    totalEvents <= 0 ||
    badEvents < 0 ||
    badEvents > totalEvents ||
    objective <= 0 ||
    objective >= 1 ||
    elapsedDays < 0 ||
    windowDays <= 0 ||
    elapsedDays > windowDays
  ) {
    throw new RangeError("Invalid SLO observations");
  }
  const allowed = 1 - objective;
  const rate = badEvents / totalEvents / allowed;
  return {
    rate,
    remainingBudgetFraction: Math.max(0, 1 - (rate * elapsedDays) / windowDays),
    exhaustedInDays: rate === 0 ? Infinity : windowDays / rate,
  };
}

/** Multiwindow thresholds: page at 14.4x over 1h/5m; ticket at 6x over 6h/30m. */
export const BURN_ALERT_THRESHOLDS = {
  page: { rate: 14.4, longWindowMinutes: 60, shortWindowMinutes: 5 },
  ticket: { rate: 6, longWindowMinutes: 360, shortWindowMinutes: 30 },
} as const;

export type SloBurnAlert = {
  readonly kind: "slo.burn_rate";
  readonly sloId: string;
  readonly rate: number;
  readonly severity: "page" | "ticket";
};

/** Structural hook compatible with the queue's async AnchorAlertSink.emit pattern. */
export type SloAlertSink = { emit(alert: SloBurnAlert): Promise<void> };

export async function emitBurnRateAlert(
  sink: SloAlertSink,
  sloId: string,
  longWindowRate: number,
  shortWindowRate: number,
): Promise<void> {
  if (
    ![longWindowRate, shortWindowRate].every(Number.isFinite) ||
    longWindowRate < 0 ||
    shortWindowRate < 0
  ) {
    throw new RangeError("Invalid burn rate");
  }
  const severity =
    longWindowRate >= BURN_ALERT_THRESHOLDS.page.rate &&
    shortWindowRate >= BURN_ALERT_THRESHOLDS.page.rate
      ? "page"
      : longWindowRate >= BURN_ALERT_THRESHOLDS.ticket.rate &&
          shortWindowRate >= BURN_ALERT_THRESHOLDS.ticket.rate
        ? "ticket"
        : undefined;
  if (severity) {
    await sink.emit({
      kind: "slo.burn_rate",
      sloId,
      rate: Math.min(longWindowRate, shortWindowRate),
      severity,
    });
  }
}
