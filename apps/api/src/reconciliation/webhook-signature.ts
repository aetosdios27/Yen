import { createHmac, timingSafeEqual } from "node:crypto";

export const PARTNER_SIGNATURE_HEADER = "x-webhook-signature";
export const PARTNER_TIMESTAMP_HEADER = "x-webhook-timestamp";
export const PARTNER_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^(?:0|[1-9][0-9]{0,11})$/;

export function signPartnerWebhook(secret: string, timestamp: string, rawBody: Uint8Array): string {
  return createHmac("sha256", secret)
    .update(`v1.${timestamp}.`, "utf8")
    .update(rawBody)
    .digest("hex");
}

export interface PartnerWebhookCredentials {
  readonly secret: string | null;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly rawBody: Uint8Array;
  readonly nowMs: number;
}

export function verifyPartnerWebhook(input: PartnerWebhookCredentials): boolean {
  const { secret, signature, timestamp, rawBody, nowMs } = input;
  if (secret === null || secret.length === 0) return false;
  if (signature === undefined || !SIGNATURE_PATTERN.test(signature)) return false;
  if (timestamp === undefined || !TIMESTAMP_PATTERN.test(timestamp)) return false;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > PARTNER_TIMESTAMP_TOLERANCE_MS) return false;
  const expected = Buffer.from(signPartnerWebhook(secret, timestamp, rawBody), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
