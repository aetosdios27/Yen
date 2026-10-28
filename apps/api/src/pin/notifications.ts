export type PinNotificationEvent =
  | {
      readonly kind: "pin_lockout";
      readonly userId: string;
      readonly recipientRoles: readonly ["approver", "owner"];
      readonly reason: "max_attempts_exceeded";
    }
  | {
      readonly kind: "pin_reset";
      readonly userId: string;
      readonly recipientRoles: readonly ["all_fund_members"];
      readonly coolingOffUntil: string;
    }
  | {
      readonly kind: "approval_executed";
      readonly approverUserId: string;
      readonly actionHash: string;
      readonly recipientRoles: readonly ["approver", "owner"];
      readonly actionSummary: Record<string, unknown>;
    };

export interface PinNotificationService {
  notify(event: PinNotificationEvent): Promise<void>;
}

export class MemoryPinNotificationService implements PinNotificationService {
  private readonly events: PinNotificationEvent[] = [];

  async notify(event: PinNotificationEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(): readonly PinNotificationEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}
