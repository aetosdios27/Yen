import {
  type ExpenseRequest,
  InMemoryPayoutKillSwitch,
  type PartnerPayoutAdapter,
  PayoutOrchestrator,
  type PseudonymId,
} from "@yen/ledger";

/**
 * API-facing payout boundary. A deployment replaces the adapter with its
 * regulated banking partner implementation; tests may use a deterministic one.
 */
export class PayoutService {
  readonly killSwitch: InMemoryPayoutKillSwitch;
  private readonly orchestrator: PayoutOrchestrator;

  constructor(adapter: PartnerPayoutAdapter, killSwitch = new InMemoryPayoutKillSwitch()) {
    this.killSwitch = killSwitch;
    this.orchestrator = new PayoutOrchestrator(adapter, killSwitch);
  }

  initiate(expense: ExpenseRequest, initiatorId: PseudonymId) {
    return this.orchestrator.initiate({ expense, initiatorId });
  }
}

/** Development adapter only: a bank transaction reference identifies acceptance. */
export class ReferencePayoutAdapter implements PartnerPayoutAdapter {
  async initiate(request: Parameters<PartnerPayoutAdapter["initiate"]>[0]) {
    return { providerPayoutId: request.idempotencyKey, status: "accepted" as const };
  }
}

/** Default adapter when banking integration is not enabled; fails closed. */
export class UnconfiguredPayoutAdapter implements PartnerPayoutAdapter {
  async initiate(): Promise<never> {
    throw new Error("No payment partner adapter is configured. Payout initiation rejected.");
  }
}
