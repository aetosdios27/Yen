import { createHmac } from "node:crypto";
import type { NotificationStore } from "@yen/notifications";
import { describe, expect, it, vi } from "vitest";
import { createDeliveryWebhookApp } from "./delivery-webhooks.js";

const secret = "local-webhook-secret";
const config = {
  metaAppSecret: secret,
  metaVerifyToken: "local-verify-token",
  exotelRelaySecret: secret,
};
const signature = (body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const mockStore = () => {
  const store = { applyDeliveryStatus: vi.fn(async (..._args: unknown[]) => true) };
  return store as unknown as NotificationStore & typeof store;
};

describe("delivery webhook signatures and idempotency", () => {
  it("verifies Meta challenge and denies bad tokens", async () => {
    const app = createDeliveryWebhookApp(mockStore(), config);
    const good = await app.request(
      "/meta?hub.mode=subscribe&hub.verify_token=local-verify-token&hub.challenge=test-challenge",
    );
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("test-challenge");
    const bad = await app.request(
      "/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=test-challenge",
    );
    expect(bad.status).toBe(403);
  });

  it("rejects bad Meta signatures without processing and handles signed replay identically", async () => {
    const store = mockStore();
    const app = createDeliveryWebhookApp(store, config);
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: "wamid.fake", status: "delivered", timestamp: "100" }] } },
          ],
        },
      ],
    });
    const bad = await app.request("/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      body,
    });
    expect(bad.status).toBe(401);
    expect(store.applyDeliveryStatus).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const replay = await app.request("/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(body) },
        body,
      });
      expect(replay.status).toBe(200);
    }
    expect(store.applyDeliveryStatus).toHaveBeenCalledTimes(2);
    expect(store.applyDeliveryStatus.mock.calls[0]?.[3]).toBe(
      store.applyDeliveryStatus.mock.calls[1]?.[3],
    );
    expect(store.applyDeliveryStatus.mock.calls[0]?.[4]).toEqual(new Date(100_000));
  });

  it("verifies signed relay SMS callbacks and normalizes terminal status", async () => {
    const store = mockStore();
    const app = createDeliveryWebhookApp(store, config);
    const body = new URLSearchParams({ SmsSid: "sms.fake", Status: "delivered" }).toString();
    const response = await app.request("/exotel", {
      method: "POST",
      headers: { "x-hub-signature-256": signature(body) },
      body,
    });
    expect(response.status).toBe(200);
    expect(store.applyDeliveryStatus).toHaveBeenCalledWith(
      "exotel_sms",
      "sms.fake",
      "delivered",
      expect.any(String),
    );
  });

  it("acknowledges signed Meta events that contain no delivery statuses", async () => {
    const store = mockStore();
    const app = createDeliveryWebhookApp(store, config);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
    const response = await app.request("/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": signature(body) },
      body,
    });
    expect(response.status).toBe(200);
    expect(store.applyDeliveryStatus).not.toHaveBeenCalled();
  });
});
