import type { PhoneE164 } from "@yen/shared";

export type OtpChannel = "whatsapp" | "sms";

export interface SendOtpRequest {
  readonly phone: PhoneE164;
  readonly code: string;
  readonly preferredChannel?: OtpChannel;
}

export interface SendOtpResult {
  readonly success: boolean;
  readonly channel: OtpChannel;
  readonly deliveryId?: string;
  readonly error?: string;
}

export interface OtpDeliveryProvider {
  sendOtp(request: SendOtpRequest): Promise<SendOtpResult>;
}

export interface SentOtpRecord {
  readonly phone: PhoneE164;
  readonly code: string;
  readonly channel: OtpChannel;
  readonly sentAt: number;
}

/**
 * Development stub OTP delivery provider.
 * Keeps an in-memory audit log of sent codes for tests and local development.
 * Note: Never logs raw OTPs or phone numbers to production loggers.
 */
export class DevStubOtpDeliveryProvider implements OtpDeliveryProvider {
  private readonly deliveries: SentOtpRecord[] = [];
  private simulateFailure = false;

  constructor(private readonly clock: () => number = Date.now) {}

  setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  async sendOtp(request: SendOtpRequest): Promise<SendOtpResult> {
    const channel = request.preferredChannel ?? "whatsapp";
    if (this.simulateFailure) {
      return {
        success: false,
        channel,
        error: "Simulated delivery failure",
      };
    }
    this.deliveries.push({
      phone: request.phone,
      code: request.code,
      channel,
      sentAt: this.clock(),
    });
    return {
      success: true,
      channel,
      deliveryId: `dev-delivery-${crypto.randomUUID()}`,
    };
  }

  getDeliveries(): readonly SentOtpRecord[] {
    return this.deliveries;
  }

  getLastDeliveryFor(phone: PhoneE164): SentOtpRecord | undefined {
    for (let i = this.deliveries.length - 1; i >= 0; i--) {
      const record = this.deliveries[i];
      if (record && record.phone === phone) {
        return record;
      }
    }
    return undefined;
  }

  clear(): void {
    this.deliveries.length = 0;
  }
}
