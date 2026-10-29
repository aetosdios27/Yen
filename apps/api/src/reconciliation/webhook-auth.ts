import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface PartnerWebhookAuthInput {
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
  readonly rawBody: Uint8Array;
  readonly nowMs: number;
  readonly toleranceSeconds: number;
  readonly secrets: readonly string[];
}

export interface AuthenticatedPartnerWebhook {
  readonly timestamp: string;
  readonly bodyHash: string;
  readonly replayKey: string;
}

export function authenticatePartnerWebhook(
  input: PartnerWebhookAuthInput,
): AuthenticatedPartnerWebhook | null {
  const { timestamp, signature, rawBody } = input;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature) return null;
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(input.nowMs / 1000) - timestampSeconds) > input.toleranceSeconds
  ) {
    return null;
  }
  const match = /^v1=([0-9a-f]{64})$/.exec(signature);
  if (!match) return null;
  const signatureHex = match.at(1);
  if (!signatureHex) return null;
  const supplied = Buffer.from(signatureHex, "hex");
  const prefix = Buffer.from(`${timestamp}.`, "utf8");
  const message = Buffer.concat([prefix, Buffer.from(rawBody)]);
  const valid = input.secrets.reduce((matched, secret) => {
    const expected = createHmac("sha256", secret).update(message).digest();
    return timingSafeEqual(expected, supplied) || matched;
  }, false);
  if (!valid) return null;

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const replayKey = createHash("sha256")
    .update(JSON.stringify([signature, timestamp, bodyHash]))
    .digest("hex");
  return { timestamp, bodyHash, replayKey };
}
