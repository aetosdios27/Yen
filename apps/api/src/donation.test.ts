import { expect, it, vi } from "vitest";
import * as z from "zod";
import { createApp } from "./app.js";
import {
  type AppDependencies,
  type DonationPledgeRequest,
  MemoryDonationPledgeStore,
} from "./dependencies.js";
import { errorEnvelope } from "./errors.js";
import { devPolicy } from "./policy.js";

const principal = { id: "00000000-0000-4000-8000-000000000001" };
const fundInput = {
  name: "Festival",
  targetPaise: "5000000",
  upiVpa: "festival@yenbank",
  upiPayeeName: "Festival Committee",
};

class RecordingStore extends MemoryDonationPledgeStore {
  readonly calls: DonationPledgeRequest[] = [];

  override async pledge(request: DonationPledgeRequest) {
    this.calls.push(request);
    return super.pledge(request);
  }
}

function setup(overrides: Partial<AppDependencies> = {}) {
  let now = 0;
  let sequence = 100;
  const app = createApp({
    principal,
    clock: () => now,
    idGenerator: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    logger: { log: () => undefined },
    policy: devPolicy,
    ...overrides,
  });
  return {
    app,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

const pledgeRequest = (body: unknown, key = "pledge-1") => ({
  method: "POST",
  headers: { "content-type": "application/json", "Idempotency-Key": key },
  body: JSON.stringify(body),
});

async function createFund(app: ReturnType<typeof setup>["app"]): Promise<string> {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "create-fund" },
    body: JSON.stringify(fundInput),
  });
  expect(response.status).toBe(201);
  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

it("publishes where-to-pay details to anyone", async () => {
  const { app } = setup();
  const fundId = await createFund(app);

  const response = await app.request(`/v1/funds/${fundId}/donation-details`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    fundId,
    title: "Festival",
    upiVpa: "festival@yenbank",
    upiPayeeName: "Festival Committee",
  });
});

it.each(["not-a-uuid", "00000000-0000-4000-8000-000000000999"])(
  "returns 404 for donation details of %s",
  async (fundId) => {
    const { app } = setup();
    const response = await app.request(`/v1/funds/${fundId}/donation-details`);
    expect(response.status).toBe(404);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe("not_found");
  },
);

it("records a self-reported pledge from a donor with no session", async () => {
  const store = new RecordingStore();
  const { app } = setup({ donationPledgeStore: store });
  const fundId = await createFund(app);

  const response = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "50000", utr: "123456789012" }),
  );

  expect(response.status).toBe(201);
  const body = z
    .object({
      donationId: z.uuid(),
      fundId: z.uuid(),
      status: z.literal("pledged"),
      amountPaise: z.string(),
    })
    .parse(await response.json());
  expect(body).toMatchObject({ fundId, status: "pledged", amountPaise: "50000" });
  expect(store.calls[0]).toMatchObject({
    fundId,
    amountPaise: 50000,
    utr: "123456789012",
    donorNameChoice: "initials",
    actorUserId: principal.id,
  });
  expect(store.calls[0]?.actorPseudonym).toMatch(/^psn_[0-9a-f-]{36}$/);
});

it("normalizes the donor's phone before storing it", async () => {
  const store = new RecordingStore();
  const { app } = setup({ donationPledgeStore: store });
  const fundId = await createFund(app);

  const response = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({
      amountPaise: "10000",
      utr: "999888777666",
      donorName: "Asha Rao",
      donorContact: "98765 43210",
    }),
  );

  expect(response.status).toBe(201);
  expect(store.calls[0]).toMatchObject({
    fundId,
    amountPaise: 10000,
    utr: "999888777666",
    donorName: "Asha Rao",
    donorContact: "+919876543210",
    donorNameChoice: "initials",
    actorUserId: principal.id,
  });
  expect(store.calls[0]?.actorPseudonym).toMatch(/^psn_[0-9a-f-]{36}$/);
});

it("records a donor's explicit per-donation full-name choice", async () => {
  const store = new RecordingStore();
  const { app } = setup({ donationPledgeStore: store });
  const fundId = await createFund(app);
  const response = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({
      amountPaise: "10000",
      utr: "989898989898",
      donorName: "Asha Rao",
      donorNameChoice: "full",
    }),
  );
  expect(response.status).toBe(201);
  expect(store.calls[0]?.donorNameChoice).toBe("full");
});

it("rejects a contact that is neither an email nor a phone number", async () => {
  const { app } = setup();
  const fundId = await createFund(app);

  const response = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "10000", utr: "121212121212", donorContact: "call me" }),
  );

  expect(response.status).toBe(400);
  const body = errorEnvelope.parse(await response.json());
  expect(body.error.code).toBe("validation_failed");
  expect(body.error.details?.map((detail) => detail.path)).toEqual([["json", "donorContact"]]);
});

it("refuses a UPI reference that is already claimed", async () => {
  const { app } = setup();
  const fundId = await createFund(app);

  const first = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "25000", utr: "111222333444" }),
  );
  expect(first.status).toBe(201);

  const second = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "25000", utr: "111222333444" }, "pledge-2"),
  );
  expect(second.status).toBe(409);
  expect(errorEnvelope.parse(await second.json()).error.code).toBe("donation_utr_claimed");
});

it("refuses a UPI reference claimed for another fund", async () => {
  const { app } = setup();
  const first = await createFund(app);
  const second = await createFund(app);

  await app.request(
    `/v1/funds/${first}/donations/pledge`,
    pledgeRequest({ amountPaise: "25000", utr: "555666777888" }),
  );
  const response = await app.request(
    `/v1/funds/${second}/donations/pledge`,
    pledgeRequest({ amountPaise: "25000", utr: "555666777888" }, "pledge-3"),
  );

  expect(response.status).toBe(409);
});

it.each([
  ["not twelve digits", { amountPaise: "50000", utr: "12345678901" }],
  ["letters in the reference", { amountPaise: "50000", utr: "12345678901a" }],
  ["zero paise", { amountPaise: "0", utr: "123456789012" }],
  ["a fraction of a rupee", { amountPaise: "12.5", utr: "123456789012" }],
  ["an amount that cannot be exact", { amountPaise: "9007199254740993", utr: "123456789012" }],
  ["an unknown field", { amountPaise: "50000", utr: "123456789012", spendable: true }],
])("rejects a pledge with %s", async (_case, body) => {
  const { app } = setup();
  const fundId = await createFund(app);

  const response = await app.request(`/v1/funds/${fundId}/donations/pledge`, pledgeRequest(body));
  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("validation_failed");
});

it("requires an idempotency key for a pledge", async () => {
  const { app } = setup();
  const fundId = await createFund(app);

  const response = await app.request(`/v1/funds/${fundId}/donations/pledge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountPaise: "50000", utr: "123456789012" }),
  });

  expect(response.status).toBe(400);
  expect(errorEnvelope.parse(await response.json()).error.details?.[0]?.path).toEqual([
    "header",
    "Idempotency-Key",
  ]);
});

it("replays a repeated pledge instead of recording it twice", async () => {
  const store = new RecordingStore();
  const { app } = setup({ donationPledgeStore: store });
  const fundId = await createFund(app);
  const body = { amountPaise: "50000", utr: "123456789012" };

  const first = await app.request(`/v1/funds/${fundId}/donations/pledge`, pledgeRequest(body));
  const replay = await app.request(`/v1/funds/${fundId}/donations/pledge`, pledgeRequest(body));

  expect(replay.status).toBe(201);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect(await replay.text()).toBe(await first.text());
  expect(store.calls).toHaveLength(1);
});

it("rate limits pledges per caller once the window is full", async () => {
  const { app, advance } = setup({ pledgeLimit: { capacity: 2, refillMs: 3600000 } });
  const fundId = await createFund(app);

  const send = (utr: string, key: string) =>
    app.request(
      `/v1/funds/${fundId}/donations/pledge`,
      pledgeRequest({ amountPaise: "50000", utr }, key),
    );

  expect((await send("100000000001", "k1")).status).toBe(201);
  expect((await send("100000000002", "k2")).status).toBe(201);

  const limited = await send("100000000003", "k3");
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("3600");
  expect(errorEnvelope.parse(await limited.json()).error.code).toBe("rate_limited");

  advance(3600000);
  expect((await send("100000000004", "k4")).status).toBe(201);
});

it("rejects an oversized pledge body", async () => {
  const { app } = setup({ pledgeBodyLimit: 128 });
  const fundId = await createFund(app);

  const response = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "50000", utr: "123456789012", donorName: "x".repeat(400) }),
  );

  expect(response.status).toBe(413);
  expect(errorEnvelope.parse(await response.json()).error.code).toBe("payload_too_large");
});

it("conceals a fund when policy refuses donations", async () => {
  const canDonate = vi.fn(() => false);
  const { app } = setup({ policy: { ...devPolicy, canDonate } });
  const fundId = await createFund(app);

  const details = await app.request(`/v1/funds/${fundId}/donation-details`);
  const pledge = await app.request(
    `/v1/funds/${fundId}/donations/pledge`,
    pledgeRequest({ amountPaise: "50000", utr: "123456789012" }),
  );

  expect(details.status).toBe(404);
  expect(pledge.status).toBe(404);
  expect(canDonate).toHaveBeenCalledTimes(2);
});
