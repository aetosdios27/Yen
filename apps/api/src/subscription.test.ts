import { MemoryFundSubscriptionStore } from "@yen/notifications";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppDependencies } from "./dependencies.js";
import { devPolicy } from "./policy.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };

function setup(overrides: Partial<AppDependencies> = {}) {
  const fundSubscriptionStore = new MemoryFundSubscriptionStore();
  let sequence = 100;

  const app = createApp({
    principal,
    clock: () => 1700000000000,
    idGenerator: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    logger: { log: () => undefined },
    policy: devPolicy,
    fundSubscriptionStore,
    ...overrides,
  });

  return { app, fundSubscriptionStore };
}

async function createFund(app: ReturnType<typeof setup>["app"]): Promise<string> {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "create-fund-sub" },
    body: JSON.stringify({
      name: "RoboCup 2026 Asia Fund",
      targetPaise: "5000000",
      upiVpa: "robocup@yenbank",
      upiPayeeName: "RoboCup Asia",
    }),
  });
  expect(response.status).toBe(201);
  const data = (await response.json()) as { id: string };
  return data.id;
}

interface SubscriptionJsonResponse {
  id?: string;
  fundId?: string;
  channel?: string;
  weeklySummary?: boolean;
  instantAlerts?: boolean;
  status?: string;
  contact?: string;
  unsubscribeToken?: string;
}

interface UnsubscribeJsonResponse {
  success?: boolean;
  fundId?: string;
  status?: string;
  unsubscribedAt?: string;
}

describe("Fund Subscriptions API", () => {
  it("subscribes to fund updates and returns non-PII record", async () => {
    const { app } = setup();
    const fundId = await createFund(app);

    const res = await app.request(`/v1/funds/${fundId}/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contact: "+919876543210",
        contactType: "phone",
        channel: "whatsapp",
        weeklySummary: true,
        instantAlerts: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as SubscriptionJsonResponse;
    expect(body.id).toBeDefined();
    expect(body.fundId).toBe(fundId);
    expect(body.channel).toBe("whatsapp");
    expect(body.weeklySummary).toBe(true);
    expect(body.instantAlerts).toBe(true);
    expect(body.status).toBe("active");
    // Ensure PII is not leaked in response
    expect(body.contact).toBeUndefined();
    expect(body.unsubscribeToken).toBeUndefined();
  });

  it("unsubscribes via POST /v1/subscriptions/unsubscribe", async () => {
    const { app, fundSubscriptionStore } = setup();
    const fundId = await createFund(app);

    const sub = await fundSubscriptionStore.subscribe({
      fundId,
      contact: "donor@example.com",
      channel: "email",
    });

    const res = await app.request("/v1/subscriptions/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: sub.unsubscribeToken }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as UnsubscribeJsonResponse;
    expect(body.success).toBe(true);
    expect(body.fundId).toBe(fundId);
    expect(body.status).toBe("unsubscribed");
    expect(body.unsubscribedAt).toBeDefined();

    // Verify subscriber is indeed unsubscribed in store
    const active = await fundSubscriptionStore.getActiveSubscribers(fundId);
    expect(active).toHaveLength(0);
  });

  it("validates token without mutating state on GET /v1/subscriptions/unsubscribe (prevents mail prefetcher unsubscribe)", async () => {
    const { app, fundSubscriptionStore } = setup();
    const fundId = await createFund(app);

    const sub = await fundSubscriptionStore.subscribe({
      fundId,
      contact: "+919988776655",
      channel: "whatsapp",
    });

    const res = await app.request(`/v1/subscriptions/unsubscribe?token=${sub.unsubscribeToken}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      fundId: string;
      status: string;
      requiresConfirmation: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.fundId).toBe(fundId);
    expect(body.status).toBe("active");
    expect(body.requiresConfirmation).toBe(true);

    // Verify subscriber is NOT unsubscribed by GET
    const active = await fundSubscriptionStore.getActiveSubscribers(fundId);
    expect(active).toHaveLength(1);
  });

  it("returns 404 for nonexistent or invalid unsubscribe token", async () => {
    const { app } = setup();

    const res = await app.request(
      "/v1/subscriptions/unsubscribe?token=0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(res.status).toBe(404);
  });
});
