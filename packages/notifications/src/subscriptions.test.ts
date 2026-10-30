import { describe, expect, it } from "vitest";
import {
  buildUnsubscribeUrl,
  determineContactType,
  generateUnsubscribeToken,
  MemoryFundSubscriptionStore,
} from "./subscriptions.js";

describe("Fund Subscription Service & Store", () => {
  it("determines contact type correctly", () => {
    expect(determineContactType("donor@example.com")).toBe("email");
    expect(determineContactType("+919876543210")).toBe("phone");
  });

  it("generates 64-char hex cryptographically secure tokens", () => {
    const token1 = generateUnsubscribeToken();
    const token2 = generateUnsubscribeToken();
    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it("builds correct one-tap unsubscribe URLs", () => {
    const url = buildUnsubscribeUrl("https://yen.org.in/", "token123");
    expect(url).toBe("https://yen.org.in/unsubscribe?token=token123");
  });

  it("creates an active subscription with defaults", async () => {
    const store = new MemoryFundSubscriptionStore();
    const sub = await store.subscribe({
      fundId: "fund-1",
      contact: "user@example.com",
    });

    expect(sub.fundId).toBe("fund-1");
    expect(sub.contact).toBe("user@example.com");
    expect(sub.contactType).toBe("email");
    expect(sub.channel).toBe("email");
    expect(sub.weeklySummary).toBe(true);
    expect(sub.instantAlerts).toBe(true);
    expect(sub.status).toBe("active");
    expect(sub.unsubscribeToken).toHaveLength(64);
    expect(sub.unsubscribedAt).toBeNull();
  });

  it("is idempotent: re-subscribing updates existing subscription", async () => {
    const store = new MemoryFundSubscriptionStore();
    const sub1 = await store.subscribe({
      fundId: "fund-1",
      contact: "+919876543210",
      channel: "whatsapp",
    });

    const sub2 = await store.subscribe({
      fundId: "fund-1",
      contact: "+919876543210",
      channel: "sms",
      weeklySummary: false,
    });

    expect(sub2.id).toBe(sub1.id);
    expect(sub2.channel).toBe("sms");
    expect(sub2.weeklySummary).toBe(false);
    expect(sub2.status).toBe("active");
  });

  it("honors one-tap unsubscribe immediately within the send cycle", async () => {
    const store = new MemoryFundSubscriptionStore();
    const sub = await store.subscribe({
      fundId: "fund-1",
      contact: "donor@example.com",
    });

    // Currently active
    let active = await store.getActiveSubscribers("fund-1");
    expect(active).toHaveLength(1);

    // Unsubscribe with token
    const unsubscribed = await store.unsubscribe(sub.unsubscribeToken);
    expect(unsubscribed).toBe(true);

    // Immediately excluded in the next cycle query
    active = await store.getActiveSubscribers("fund-1");
    expect(active).toHaveLength(0);

    // Stored status is updated
    const fetched = await store.getByToken(sub.unsubscribeToken);
    expect(fetched?.status).toBe("unsubscribed");
    expect(fetched?.unsubscribedAt).toBeInstanceOf(Date);
  });

  it("returns false when unsubscribing with an unknown or already-unsubscribed token", async () => {
    const store = new MemoryFundSubscriptionStore();
    const result1 = await store.unsubscribe("non-existent-token");
    expect(result1).toBe(false);

    const sub = await store.subscribe({ fundId: "fund-1", contact: "+919876543210" });
    await store.unsubscribe(sub.unsubscribeToken);

    // Second unsubscribe attempt on same token
    const result2 = await store.unsubscribe(sub.unsubscribeToken);
    expect(result2).toBe(false);
  });

  it("filters subscribers by preference", async () => {
    const store = new MemoryFundSubscriptionStore();
    await store.subscribe({
      fundId: "fund-1",
      contact: "user1@example.com",
      weeklySummary: true,
      instantAlerts: false,
    });
    await store.subscribe({
      fundId: "fund-1",
      contact: "user2@example.com",
      weeklySummary: false,
      instantAlerts: true,
    });

    const weekly = await store.getActiveSubscribers("fund-1", { weeklySummary: true });
    expect(weekly.map((s) => s.contact)).toEqual(["user1@example.com"]);

    const alerts = await store.getActiveSubscribers("fund-1", { instantAlerts: true });
    expect(alerts.map((s) => s.contact)).toEqual(["user2@example.com"]);
  });
});
