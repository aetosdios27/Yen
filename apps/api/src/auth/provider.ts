import {
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResponse,
  type PhoneE164,
  parsePhoneE164,
} from "@yen/shared";

export type OtpChannel = "whatsapp" | "sms";

export class UnconfiguredOtpDeliveryProvider implements DeliveryProvider {
  async send(_request: DeliveryRequest): Promise<DeliveryResponse> {
    throw new Error("Delivery provider is not configured");
  }
}

export class ConfiguredDeliveryProvider implements DeliveryProvider {
  constructor(private readonly providers: Readonly<Record<OtpChannel, DeliveryProvider>>) {}

  send(request: DeliveryRequest): Promise<DeliveryResponse> {
    return this.providers[request.channel].send(request);
  }
}

export function createOtpDeliveryProvider(
  environment: "development" | "test" | "production",
  clock: () => number = Date.now,
  providers?: Readonly<Record<OtpChannel, DeliveryProvider>>,
): DeliveryProvider {
  if (providers) return new ConfiguredDeliveryProvider(providers);
  if (environment === "production") {
    return new UnconfiguredOtpDeliveryProvider();
  }
  return new DevStubOtpDeliveryProvider(clock);
}

export interface SentOtpRecord {
  readonly phone: PhoneE164;
  readonly code: string;
  readonly channel: OtpChannel;
  readonly sentAt: number;
}

/** Local-only stub. The in-memory record is available only to tests/dev tooling. */
export class DevStubOtpDeliveryProvider implements DeliveryProvider {
  private readonly deliveries: SentOtpRecord[] = [];
  private readonly responses = new Map<string, DeliveryResponse>();
  private simulateFailure = false;

  constructor(private readonly clock: () => number = Date.now) {}

  setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  async send(request: DeliveryRequest): Promise<DeliveryResponse> {
    if (request.channel !== "whatsapp" && request.channel !== "sms")
      throw new Error("Unsupported delivery channel");
    const existing = this.responses.get(`${request.channel}:${request.idempotencyKey}`);
    if (existing) return existing;
    if (this.simulateFailure) throw new Error("Simulated delivery failure");
    if (request.template === "otp") {
      const phone = parsePhoneE164(request.to);
      if (!phone.ok) throw new Error("Delivery recipient phone number is invalid");
      this.deliveries.push({
        phone: phone.value,
        code: request.params.code ?? "",
        channel: request.channel,
        sentAt: this.clock(),
      });
    }
    const response: DeliveryResponse = {
      messageId: `dev-delivery-${crypto.randomUUID()}`,
      status: "accepted",
      idempotencyGuaranteed: true,
    };
    this.responses.set(`${request.channel}:${request.idempotencyKey}`, response);
    return response;
  }

  getDeliveries(): readonly SentOtpRecord[] {
    return this.deliveries;
  }

  getLastDeliveryFor(phone: PhoneE164): SentOtpRecord | undefined {
    for (let index = this.deliveries.length - 1; index >= 0; index--) {
      const record = this.deliveries[index];
      if (record?.phone === phone) return record;
    }
    return undefined;
  }

  clear(): void {
    this.deliveries.length = 0;
    this.responses.clear();
  }
}
