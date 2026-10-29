export type DeliveryChannel = "whatsapp" | "sms";
export type DeliveryStatus = "accepted" | "delivered" | "failed";

/** Channel-neutral provider contract shared by login OTP and outbox delivery. */
export interface DeliveryRequest {
  channel: DeliveryChannel;
  to: string;
  template: string;
  params: Readonly<Record<string, string>>;
  idempotencyKey: string;
}

export interface DeliveryResponse {
  messageId: string;
  status: DeliveryStatus;
  /** True only when the provider guarantees dedupe for the supplied key. */
  idempotencyGuaranteed: boolean;
}

export interface DeliveryProvider {
  send(request: DeliveryRequest): Promise<DeliveryResponse>;
}
