import {
  type AlertRow,
  acknowledgeAlert,
  getAlert,
  listAlerts,
  raiseRepeatedRejectionsIfThreshold,
  raiseSpendRateSpikeIfSpiking,
  resolveAlert,
  type Sql,
} from "@yen/db";

/** Fund alert access for the API layer. Postgres-backed in production, no-op in memory. */
export interface AlertStore {
  get(alertId: string): Promise<AlertRow | null>;
  list(fundId: string, limit: number, before?: string | null): Promise<AlertRow[]>;
  acknowledge(
    alertId: string,
    actorPseudonym: string,
    note: string,
    now: Date,
  ): Promise<AlertRow | null>;
  resolve(
    alertId: string,
    actorPseudonym: string,
    note: string,
    now: Date,
  ): Promise<AlertRow | null>;
  /** Called after an expense is rejected; raises repeated_rejected_requests when due. */
  onExpenseRejected(fundId: string, now: Date): Promise<void>;
  /** Called after an expense is paid; raises spend_rate_spike when due. */
  onExpensePaid(fundId: string, now: Date): Promise<void>;
  /** Type/severity/time only, for the public fund timeline. */
  listForTimeline(fundId: string, limit?: number): Promise<AlertRow[]>;
}

export class PostgresAlertStore implements AlertStore {
  constructor(private readonly sql: Sql) {}

  get(alertId: string) {
    return getAlert(this.sql, alertId);
  }

  list(fundId: string, limit: number, before: string | null = null) {
    return listAlerts(this.sql, { fundId, limit, before });
  }

  acknowledge(alertId: string, actorPseudonym: string, note: string, now: Date) {
    return acknowledgeAlert(this.sql, { alertId, actorPseudonym, note, now });
  }

  resolve(alertId: string, actorPseudonym: string, note: string, now: Date) {
    return resolveAlert(this.sql, { alertId, actorPseudonym, note, now });
  }

  async onExpenseRejected(fundId: string, now: Date) {
    await raiseRepeatedRejectionsIfThreshold(this.sql, fundId, now);
  }

  async onExpensePaid(fundId: string, now: Date) {
    await raiseSpendRateSpikeIfSpiking(this.sql, fundId, now);
  }

  listForTimeline(fundId: string, limit = 200) {
    return listAlerts(this.sql, { fundId, limit });
  }
}

export class MemoryAlertStore implements AlertStore {
  async get(): Promise<AlertRow | null> {
    return null;
  }
  async list(): Promise<AlertRow[]> {
    return [];
  }
  async acknowledge(): Promise<AlertRow | null> {
    return null;
  }
  async resolve(): Promise<AlertRow | null> {
    return null;
  }
  async onExpenseRejected(): Promise<void> {}
  async onExpensePaid(): Promise<void> {}
  async listForTimeline(): Promise<AlertRow[]> {
    return [];
  }
}
