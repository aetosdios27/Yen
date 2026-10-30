import { type ExpenseRequest, InMemoryExpenseStore } from "@yen/ledger";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  type AppDependencies,
  MemoryDisplayNameStore,
  MemoryFundStore,
  type PublicFundReadStore,
} from "./dependencies.js";
import { devPolicy } from "./policy.js";
import {
  PRIVATE_READ_CACHE_CONTROL,
  PUBLIC_READ_CACHE_CONTROL,
  PublicReadCache,
} from "./public-cache.js";

const owner = { id: "00000000-0000-4000-8000-000000000001", role: "owner" as const };
const fundA = "00000000-0000-4000-8000-0000000000a1";
const fundB = "00000000-0000-4000-8000-0000000000b2";
const startedAt = Date.parse("2026-10-30T00:00:00.000Z");

const expense = (fundId: string) =>
  ({
    id: "00000000-0000-4000-8000-000000000020",
    fundId,
    requesterId: "psn_00000000-0000-4000-8000-000000000021",
    amountPaise: 2500n,
    description: "fixture expense",
    recipientRef: "private-payee",
    status: "paid",
    holdId: null,
    approvals: [],
    evidence: [],
    supersedesId: null,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    submittedAt: "2026-10-28T00:00:00.000Z",
    objectionEndsAt: null,
    approvedAt: "2026-10-28T00:00:00.000Z",
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    paidAt: "2026-10-28T00:00:00.000Z",
    reconciledAt: null,
    bankTransactionId: null,
    expiresAt: null,
    phone: "+919876543210",
    utr: "ABCDEF123456789",
  }) as unknown as ExpenseRequest;

function fixture(options: { gate?: Promise<void> } = {}) {
  let now = startedAt;
  const clock = () => now;
  const cache = new PublicReadCache({ clock });
  const fundStore = new MemoryFundStore();
  const displayNameStore = new MemoryDisplayNameStore();
  const base = new InMemoryExpenseStore();
  const reads = { list: 0, donations: 0 };
  let failOrigin = false;

  const expenseStore = {
    ...base,
    get: base.get.bind(base),
    save: base.save.bind(base),
    atomicApprove: base.atomicApprove.bind(base),
    list: async (fundId: string) => {
      reads.list += 1;
      if (options.gate) await options.gate;
      return fundId === fundA || fundId === fundB ? [expense(fundId)] : [];
    },
  } as AppDependencies["expenseStore"];

  const publicFundReadStore: PublicFundReadStore = {
    donations: async () => {
      reads.donations += 1;
      if (failOrigin) throw new Error("statement store unavailable");
      return [];
    },
  };

  const shared = {
    fundStore,
    expenseStore,
    displayNameStore,
    publicFundReadStore,
    publicReadCache: cache,
    policy: devPolicy,
    clock,
    logger: { log: () => undefined },
  } satisfies Partial<AppDependencies>;

  const publicApp = createApp({ ...shared, principal: null, idGenerator: () => fundA });
  // Fund creation takes its id from the generator, so each fund needs its own app.
  const ownerApp = createApp({ ...shared, principal: owner, idGenerator: () => fundA });
  const secondOwnerApp = createApp({ ...shared, principal: owner, idGenerator: () => fundB });

  return {
    publicApp,
    ownerApp,
    secondOwnerApp,
    cache,
    reads,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    failOrigin: (value: boolean) => {
      failOrigin = value;
    },
  };
}

async function createFund(app: ReturnType<typeof createApp>, key: string) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      name: `Fund ${key}`,
      purpose: "Community equipment",
      visibility: "public",
      targetPaise: "9000",
      upiVpa: "committee@yenbank",
      upiPayeeName: "Committee",
    }),
  });
  expect(response.status).toBe(201);
}

async function createTwoFunds(apps: ReturnType<typeof fixture>) {
  await createFund(apps.ownerApp, "fund-a");
  await createFund(apps.secondOwnerApp, "fund-b");
}

const summaryUrl = (fundId: string) => `/v1/funds/${fundId}/public/summary`;

describe("public fund read caching", () => {
  it("serves anonymous fund reads with a shared cache policy and a strong validator", async () => {
    const apps = fixture();
    const { publicApp, ownerApp } = apps;
    await createTwoFunds(apps);

    const response = await publicApp.request(summaryUrl(fundA));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers.get("vary")).toContain("cookie");
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const apps = fixture();
    const { publicApp, ownerApp, reads } = apps;
    await createTwoFunds(apps);

    const first = await publicApp.request(summaryUrl(fundA));
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const second = await publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(reads.donations).toBe(1);
  });

  it("keeps the signed-in view private and out of the shared cache", async () => {
    const apps = fixture();
    const { publicApp, ownerApp, cache } = apps;
    await createTwoFunds(apps);

    const response = await ownerApp.request(summaryUrl(fundA));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PRIVATE_READ_CACHE_CONTROL);
    expect(response.headers.get("etag")).toBeNull();
    expect(cache.read(fundA, "summary")).toBeUndefined();

    const anonymous = await publicApp.request(summaryUrl(fundA));
    expect(anonymous.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
  });

  it("reads the origin once when concurrent requests miss the cache", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apps = fixture({ gate });
    const { publicApp, ownerApp, reads } = apps;
    await createTwoFunds(apps);

    const inFlight = Array.from({ length: 6 }, () => publicApp.request(summaryUrl(fundA)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const responses = await Promise.all(inFlight);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(reads.donations).toBe(1);
  });

  it("invalidates only the fund that changed", async () => {
    const apps = fixture();
    const { publicApp, ownerApp, cache, reads } = apps;
    await createTwoFunds(apps);

    expect((await publicApp.request(summaryUrl(fundA))).status).toBe(200);
    expect((await publicApp.request(summaryUrl(fundB))).status).toBe(200);
    expect(cache.read(fundA, "summary")).toBeDefined();
    expect(cache.read(fundB, "summary")).toBeDefined();

    const pledge = await publicApp.request(`/v1/funds/${fundA}/donations/pledge`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "pledge-a" },
      body: JSON.stringify({ amountPaise: "50000", utr: "123456789012" }),
    });
    expect(pledge.status).toBe(201);
    expect(cache.read(fundA, "summary")).toBeUndefined();
    expect(cache.read(fundB, "summary")).toBeDefined();

    const before = reads.donations;
    expect((await publicApp.request(summaryUrl(fundB))).status).toBe(200);
    expect(reads.donations).toBe(before);
    expect((await publicApp.request(summaryUrl(fundA))).status).toBe(200);
    expect(reads.donations).toBe(before + 1);
  });

  it("serves the last good copy with an as-of marker when the origin fails", async () => {
    const apps = fixture();
    const { publicApp, ownerApp, advance, failOrigin } = apps;
    await createTwoFunds(apps);
    expect((await publicApp.request(summaryUrl(fundA))).status).toBe(200);

    failOrigin(true);
    advance(120_000);
    const stale = await publicApp.request(summaryUrl(fundA));

    expect(stale.status).toBe(200);
    expect(stale.headers.get("x-yen-data-as-of")).toBe(new Date(startedAt).toISOString());
    expect(stale.headers.get("warning")).toContain("Response is stale");
    expect(stale.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(await stale.json()).toMatchObject({ fundId: fundA });
  });

  it("reports a failure when there is no copy to fall back to", async () => {
    const apps = fixture();
    const { publicApp, ownerApp, failOrigin } = apps;
    await createTwoFunds(apps);

    failOrigin(true);
    const response = await publicApp.request(summaryUrl(fundB));
    expect(response.status).toBe(500);
    expect(response.headers.get("x-yen-data-as-of")).toBeNull();
  });
});
