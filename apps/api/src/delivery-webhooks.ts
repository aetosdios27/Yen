import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationStore } from "@yen/notifications";
import { Hono } from "hono";

export interface DeliveryWebhookConfig {
  metaAppSecret: string;
  metaVerifyToken: string;
  exotelRelaySecret: string;
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMetaSignature(
  rawBody: string | Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signature.toLowerCase(), expected);
}

function eventKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

export function createDeliveryWebhookApp(
  store: NotificationStore,
  config: DeliveryWebhookConfig,
): Hono {
  const app = new Hono();

  app.get("/meta", (context) => {
    const mode = context.req.query("hub.mode") ?? "";
    const token = context.req.query("hub.verify_token") ?? "";
    const challenge = context.req.query("hub.challenge") ?? "";
    if (mode !== "subscribe" || !safeEqual(token, config.metaVerifyToken) || !challenge) {
      return context.text("Forbidden", 403);
    }
    return context.text(challenge, 200);
  });

  app.post("/meta", async (context) => {
    const rawBody = new Uint8Array(await context.req.arrayBuffer());
    if (
      !verifyMetaSignature(rawBody, context.req.header("x-hub-signature-256"), config.metaAppSecret)
    ) {
      return context.text("Unauthorized", 401);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return context.text("Bad Request", 400);
    }
    const statuses = extractMetaStatuses(payload);
    if (!statuses) return context.text("Bad Request", 400);
    for (const status of statuses) {
      const normalized =
        status.status === "failed"
          ? "dead_letter"
          : ["delivered", "read"].includes(status.status)
            ? "delivered"
            : undefined;
      if (!normalized) continue;
      const key = eventKey([status.id, status.status, status.timestamp]);
      await store.applyDeliveryStatus(
        "meta_whatsapp",
        status.id,
        normalized,
        key,
        parseMetaTimestamp(status.timestamp),
      );
    }
    return context.text("OK", 200);
  });

  app.post("/exotel", async (context) => {
    const rawBody = new Uint8Array(await context.req.arrayBuffer());
    // Exotel's opened SMS reference documents callback fields but no webhook signature.
    // Accept only an HMAC-signing relay callback; direct Exotel callback authenticity is
    // not verified. The Meta docs accessible here confirm the header and app secret, but
    // not the HMAC-SHA256 raw-byte calculation implemented above; see docs/REFERENCES.md.
    if (
      !verifyMetaSignature(
        rawBody,
        context.req.header("x-hub-signature-256"),
        config.exotelRelaySecret,
      )
    ) {
      return context.text("Unauthorized", 401);
    }
    const fields = new URLSearchParams(new TextDecoder().decode(rawBody));
    const id = fields.get("SmsSid");
    const status = fields.get("Status")?.toLowerCase();
    if (!id || !status) return context.text("Bad Request", 400);
    const normalized = ["sent", "delivered"].includes(status)
      ? "delivered"
      : status.startsWith("failed")
        ? "dead_letter"
        : undefined;
    if (normalized)
      await store.applyDeliveryStatus("exotel_sms", id, normalized, eventKey([id, status]));
    return context.text("OK", 200);
  });

  return app;
}

function extractMetaStatuses(
  payload: unknown,
): Array<{ id: string; status: string; timestamp: string }> | undefined {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("entry" in payload) ||
    !Array.isArray(payload.entry)
  )
    return undefined;
  const results: Array<{ id: string; status: string; timestamp: string }> = [];
  for (const entry of payload.entry) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("changes" in entry) ||
      !Array.isArray(entry.changes)
    )
      continue;
    for (const change of entry.changes) {
      if (
        !change ||
        typeof change !== "object" ||
        !("value" in change) ||
        !change.value ||
        typeof change.value !== "object" ||
        !("statuses" in change.value) ||
        !Array.isArray(change.value.statuses)
      )
        continue;
      for (const item of change.value.statuses) {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.id !== "string" ||
          typeof item.status !== "string"
        )
          return undefined;
        results.push({
          id: item.id,
          status: item.status,
          timestamp: typeof item.timestamp === "string" ? item.timestamp : "",
        });
      }
    }
  }
  return results;
}

function parseMetaTimestamp(timestamp: string): Date | null {
  if (!/^\d+$/.test(timestamp)) return null;
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}
