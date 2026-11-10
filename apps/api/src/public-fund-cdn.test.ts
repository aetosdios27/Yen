import { type ExpenseRequest, InMemoryExpenseStore } from "@yen/ledger";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  type AppDependencies,
  MemoryDisplayNameStore,
  MemoryFundStore,
  type PublicFundHead,
} from "./dependencies.js";
import { devPolicy } from "./policy.js";
import {
  eventHashEtag,
  FUND_HEAD_KIND,
  fundCacheTags,
  PRIVATE_READ_CACHE_CONTROL,
  PUBLIC_READ_CACHE_CONTROL,
  PublicReadCache,
} from "./public-cache.js";
import { signPartnerWebhook } from "./reconciliation/webhook-signature.js";
import { MemoryRateLimitStore } from "./stores.js";

const owner = { id: "00000000-0000-4000-8000-000000000001", role: "owner" as const };
const donor = { id: "00000000-0000-4000-8000-000000000002", role: "donor" as const };
const fundA = "00000000-0000-4000-8000-0000000000a1";
const fundB = "00000000-0000-4000-8000-0000000000b2";
const fundC = "00000000-0000-4000-8000-0000000000c3";
const startedAt = Date.parse("2026-11-01T00:00:00.000Z");
const hashOne = "a".repeat(64);
const hashTwo = "b".repeat(64);
const orgIdFor = (fundId: string) => `org-${fundId.slice(-2)}`;
const webhookSecret = "partner-webhook-secret-for-invalidation-tests";

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

type FixtureOptions = {
  headGate?: Promise<void>;
  missLimit?: { capacity: number; refillMs: number };
  auditBundleProvider?: AppDependencies["auditBundleProvider"];
};

function fixture(options: FixtureOptions = {}) {
  let now = startedAt;
  const clock = () => now;
  const cache = new PublicReadCache({ clock });
  const fundStore = new MemoryFundStore();
  const displayNameStore = new MemoryDisplayNameStore();
  const base = new InMemoryExpenseStore();
  const reads = { list: 0, donations: 0, heads: 0, missChecks: 0 };
  let headHash = hashOne;
  let failOrigin = false;
  let ip = "203.0.113.10";

  const expenseStore = {
    ...base,
    get: base.get.bind(base),
    save: base.save.bind(base),
    atomicApprove: base.atomicApprove.bind(base),
    list: async (fundId: string) => {
      reads.list += 1;
      if (options.headGate) await options.headGate;
      return fundId === fundA || fundId === fundB ? [expense(fundId)] : [];
    },
  } as AppDependencies["expenseStore"];

  const publicFundReadStore: AppDependencies["publicFundReadStore"] = {
    pledgedPaise: async () => 0n,
    anchoredItems: async () => new Set<string>(),
    donations: async () => {
      reads.donations += 1;
      if (failOrigin) throw new Error("statement store unavailable");
      return [];
    },
  };

  const publicFundHead = async (fundId: string): Promise<PublicFundHead | null> => {
    if (fundId !== fundA && fundId !== fundB) return null;
    reads.heads += 1;
    if (options.headGate) await options.headGate;
    return { latestEventHash: headHash, orgId: orgIdFor(fundId) };
  };

  const memoryRateLimits = new MemoryRateLimitStore();
  const rateLimitStore: AppDependencies["rateLimitStore"] = {
    consume: async (key, limit, nowMs) => {
      if (key.startsWith('["fund_cache_miss"')) reads.missChecks += 1;
      return memoryRateLimits.consume(key, limit, nowMs);
    },
  };

  const shared = {
    fundStore,
    expenseStore,
    displayNameStore,
    publicFundReadStore,
    publicReadCache: cache,
    publicFundHead,
    policy: devPolicy,
    clock,
    logger: { log: () => undefined },
    rateLimitStore,
    clientIp: () => ip,
    fundReadMissLimit: options.missLimit ?? { capacity: 10, refillMs: 60_000 },
    partnerWebhookSecret: webhookSecret,
    ...(options.auditBundleProvider ? { auditBundleProvider: options.auditBundleProvider } : {}),
  } satisfies Partial<AppDependencies>;

  const publicApp = createApp({ ...shared, principal: null, idGenerator: () => fundA });
  const ownerApp = createApp({ ...shared, principal: owner, idGenerator: () => fundA });
  const secondOwnerApp = createApp({ ...shared, principal: owner, idGenerator: () => fundB });
  const donorApp = createApp({ ...shared, principal: donor, idGenerator: () => fundA });
  const privateOwnerApp = createApp({ ...shared, principal: owner, idGenerator: () => fundC });

  return {
    publicApp,
    ownerApp,
    secondOwnerApp,
    donorApp,
  privateOwnerApp,
  cache,
  fundStore,
  reads,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    failOrigin: (value: boolean) => {
      failOrigin = value;
    },
    setHeadHash: (value: string) => {
      headHash = value;
    },
    setIp: (value: string) => {
      ip = value;
    },
  };
}

async function createFund(
  app: ReturnType<typeof fixture>["publicApp"],
  key: string,
  visibility = "public",
) {
  const response = await app.request("/v1/funds", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      name: `Fund ${key}`,
      purpose: "Community equipment",
      visibility,
      targetPaise: "9000",
      upiVpa: "committee@yenbank",
      upiPayeeName: "Committee",
    }),
  });
  expect(response.status).toBe(201);
}

async function createPublicFunds(apps: ReturnType<typeof fixture>) {
  await createFund(apps.ownerApp, "fund-a");
  await createFund(apps.secondOwnerApp, "fund-b");
}

const summaryUrl = (fundId: string) => `/v1/funds/${fundId}/public/summary`;

describe("public fund CDN validators and tags", () => {
  it("stamps public reads with the event hash validator and purge tags", async () => {
    const apps = fixture();
    await createPublicFunds(apps);

    const response = await apps.publicApp.request(summaryUrl(fundA));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(response.headers.get("etag")).toBe(eventHashEtag(fundA, hashOne));
    expect(response.headers.get("cache-tag")).toBe(fundCacheTags(fundA, orgIdFor(fundA)));
    expect(response.headers.get("vary")).toContain("cookie");
  });

  it("answers a cold conditional read with one head lookup and no page read", async () => {
    const apps = fixture();
    await createPublicFunds(apps);

    const response = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": eventHashEtag(fundA, hashOne) },
    });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(eventHashEtag(fundA, hashOne));
    expect(response.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(response.headers.get("cache-tag")).toBe(fundCacheTags(fundA, orgIdFor(fundA)));
    expect(apps.reads.heads).toBe(1);
    expect(apps.reads.donations).toBe(0);
    expect(apps.reads.list).toBe(0);
  });

  it("serves a warm conditional read without any query", async () => {
    const apps = fixture();
    await createPublicFunds(apps);

    const first = await apps.publicApp.request(summaryUrl(fundA));
    expect(first.headers.get("etag")).toBe(eventHashEtag(fundA, hashOne));
    expect(apps.reads.heads).toBe(1);

    const second = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": eventHashEtag(fundA, hashOne) },
    });
    expect(second.status).toBe(304);
    expect(apps.reads.heads).toBe(1);
    expect(apps.reads.donations).toBe(1);
  });

  it("coalesces concurrent conditional reads into one head lookup", async () => {
    let release: () => void = () => undefined;
    const headGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apps = fixture({ headGate });
    await createPublicFunds(apps);

    const etag = eventHashEtag(fundA, hashOne);
    const batch = Array.from({ length: 8 }, () =>
      apps.publicApp.request(summaryUrl(fundA), { headers: { "if-none-match": etag } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const responses = await Promise.all(batch);

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 8 }, () => 304),
    );
    expect(apps.reads.heads).toBe(1);
  });

  it("runs the full read for no-cache clients and keeps the validator when unchanged", async () => {
    const apps = fixture();
    await createPublicFunds(apps);
    await apps.publicApp.request(summaryUrl(fundA));

    const response = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "cache-control": "no-cache", "if-none-match": eventHashEtag(fundA, hashOne) },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(eventHashEtag(fundA, hashOne));
    expect(apps.reads.donations).toBe(2);
  });

  it("rotates the validator after an event advances the log head", async () => {
    const apps = fixture();
    await createPublicFunds(apps);
    const first = await apps.publicApp.request(summaryUrl(fundA));
    const old = first.headers.get("etag");
    expect(old).toBe(eventHashEtag(fundA, hashOne));

    const pledge = await apps.publicApp.request(`/v1/funds/${fundA}/donations/pledge`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "pledge-a" },
      body: JSON.stringify({ amountPaise: "50000", utr: "123456789012" }),
    });
    expect(pledge.status).toBe(201);
    apps.setHeadHash(hashTwo);
    expect(apps.cache.read(fundA, FUND_HEAD_KIND)).toBeUndefined();

    const stale = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": old ?? "" },
    });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("etag")).toBe(eventHashEtag(fundA, hashTwo));

    const current = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": eventHashEtag(fundA, hashTwo) },
    });
    expect(current.status).toBe(304);
  });

  it("drops the head entry with the pages when a fund changes", async () => {
    const apps = fixture();
    await createPublicFunds(apps);
    await apps.publicApp.request(summaryUrl(fundA));
    await apps.publicApp.request(summaryUrl(fundB));
    const before = apps.reads.heads;
    expect(apps.cache.read(fundA, FUND_HEAD_KIND)).toBeDefined();
    expect(apps.cache.read(fundB, FUND_HEAD_KIND)).toBeDefined();

    const pledge = await apps.publicApp.request(`/v1/funds/${fundA}/donations/pledge`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "pledge-drop" },
      body: JSON.stringify({ amountPaise: "50000", utr: "123456789013" }),
    });
    expect(pledge.status).toBe(201);
    expect(apps.cache.read(fundA, "summary")).toBeUndefined();
    expect(apps.cache.read(fundA, FUND_HEAD_KIND)).toBeUndefined();
    expect(apps.cache.read(fundB, FUND_HEAD_KIND)).toBeDefined();

    await apps.publicApp.request(summaryUrl(fundA));
    expect(apps.reads.heads).toBe(before + 1);
  });
});

describe("public fund origin protection", () => {
  it("rate limits origin reads per ip while hits and 304s stay exempt", async () => {
    const apps = fixture({ missLimit: { capacity: 1, refillMs: 60_000 } });
    await createPublicFunds(apps);

    const firstMiss = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "cache-control": "no-cache" },
    });
    expect(firstMiss.status).toBe(200);
    expect(apps.reads.missChecks).toBe(1);

    const blocked = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "cache-control": "no-cache" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(apps.reads.missChecks).toBe(2);

    const hit = await apps.publicApp.request(summaryUrl(fundA));
    expect(hit.status).toBe(200);
    expect(apps.reads.missChecks).toBe(2);

    const revalidated = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "if-none-match": eventHashEtag(fundA, hashOne) },
    });
    expect(revalidated.status).toBe(304);
    expect(apps.reads.missChecks).toBe(2);

    apps.setIp("198.51.100.7");
    const otherIp = await apps.publicApp.request(summaryUrl(fundA), {
      headers: { "cache-control": "no-cache" },
    });
    expect(otherIp.status).toBe(200);
    expect(apps.reads.missChecks).toBe(3);
  });

  it("shares one origin read between concurrent misses and spends one miss per burst", async () => {
    let release: () => void = () => undefined;
    const headGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apps = fixture({ headGate, missLimit: { capacity: 1, refillMs: 60_000 } });
    await createPublicFunds(apps);

    const batch = Array.from({ length: 25 }, () => apps.publicApp.request(summaryUrl(fundA)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const responses = await Promise.all(batch);

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 25 }, () => 200),
    );
    expect(apps.reads.missChecks).toBe(1);
    expect(apps.reads.donations).toBe(1);
  });
});

describe("public fund privacy leakage matrix", () => {
  it("keeps authenticated owner and donor views out of the shared cache", async () => {
    const apps = fixture();
    await createPublicFunds(apps);

    const ownerView = await apps.ownerApp.request(summaryUrl(fundA));
    expect(ownerView.status).toBe(200);
    expect(ownerView.headers.get("cache-control")).toBe(PRIVATE_READ_CACHE_CONTROL);
    expect(ownerView.headers.get("etag")).toBeNull();
    expect(ownerView.headers.get("cache-tag")).toBeNull();
    expect(apps.cache.read(fundA, "summary")).toBeUndefined();

    const donorView = await apps.donorApp.request(summaryUrl(fundA));
    expect(donorView.headers.get("cache-control")).toBe(PRIVATE_READ_CACHE_CONTROL);
    expect(donorView.headers.get("etag")).toBeNull();
    expect(donorView.headers.get("cache-tag")).toBeNull();

    const anonymous = await apps.publicApp.request(summaryUrl(fundA));
    expect(anonymous.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(anonymous.headers.get("cache-tag")).toBe(fundCacheTags(fundA, orgIdFor(fundA)));
    const entry = apps.cache.read(fundA, "summary");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.body)).not.toContain("Community equipment");
    expect(JSON.stringify(entry?.body)).not.toContain(owner.id);
  });

  it("emits no public headers when an anonymous visitor asks for a private fund", async () => {
    const apps = fixture();
    await createFund(apps.privateOwnerApp, "fund-c", "private");

    const response = await apps.publicApp.request(summaryUrl(fundC));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-tag")).toBeNull();
    expect(apps.cache.read(fundC, "summary")).toBeUndefined();
    expect(apps.cache.read(fundC, FUND_HEAD_KIND)).toBeUndefined();
  });

  it("serves the authenticated fund route without public cache headers", async () => {
    const apps = fixture();
    await createPublicFunds(apps);

    const response = await apps.ownerApp.request(`/v1/funds/${fundA}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-tag")).toBeNull();
    expect(apps.cache.read(fundA, "summary")).toBeUndefined();
  });

  it("drops cached public reads when a statement upload writes events", async () => {
    const apps = fixture();
    await createPublicFunds(apps);
    await apps.publicApp.request(summaryUrl(fundA));
    await apps.publicApp.request(summaryUrl(fundB));
    expect(apps.cache.read(fundA, "summary")).toBeDefined();

    const upload = await apps.ownerApp.request("/v1/reconciliation/statements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fundId: fundA,
        csvContent:
          "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance\n28/10/2026,UPI/CR/123456789012/DONATION,123456789012,28/10/2026,,500.00,10500.00",
      }),
    });
    expect(upload.status).toBe(200);
    expect(apps.cache.read(fundA, "summary")).toBeUndefined();
    expect(apps.cache.read(fundA, FUND_HEAD_KIND)).toBeUndefined();
    expect(apps.cache.read(fundB, "summary")).toBeDefined();
  });

  it("drops cached public reads when a partner webhook writes events", async () => {
    const apps = fixture();
    await createPublicFunds(apps);
    await apps.publicApp.request(summaryUrl(fundA));
    expect(apps.cache.read(fundA, "summary")).toBeDefined();

    const body = JSON.stringify({
      event: "virtual_account.credited",
      timestamp: "2026-11-01T00:01:00.000Z",
      data: {
        fund_id: fundA,
        bank_reference: "REF123",
        amount_paise: 50000,
        type: "credit",
        posted_at: "2026-11-01T00:01:00.000Z",
        utr: "123456789012",
      },
    });
    const timestamp = "1793491260";
    const response = await apps.publicApp.request("/v1/reconciliation/webhooks/partner", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": signPartnerWebhook(
          webhookSecret,
          timestamp,
          new TextEncoder().encode(body),
        ),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(apps.cache.read(fundA, "summary")).toBeUndefined();
    expect(apps.cache.read(fundA, FUND_HEAD_KIND)).toBeUndefined();
  });

  it("aligns audit bundle reads with the shared public cache policy", async () => {
    const bundle = {
      format: "yen/audit-bundle/v1",
      fund_id: fundA,
      chain: { start_seq: 0, start_hash: "0".repeat(64) },
      events: [],
      roots: [],
      anchor: {
        chain_id: 1,
        contract_address: `0x${"0".repeat(40)}`,
        tx_hash: `0x${"0".repeat(64)}`,
        root: "0".repeat(64),
        sequence: 1,
      },
    };
    const apps = fixture({
      auditBundleProvider: {
        getAuditBundle: async () => bundle,
        getRecordProof: async () => null,
      },
    });
    await createPublicFunds(apps);
    const record = apps.fundStore.get(fundA);
    if (!record) throw new Error("Missing fund record");
    apps.fundStore.set(fundA, { ...record, orgId: orgIdFor(fundA) });

    const anonymous = await apps.publicApp.request(`/v1/funds/${fundA}/audit-bundle`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("cache-control")).toBe(PUBLIC_READ_CACHE_CONTROL);
    expect(anonymous.headers.get("cache-tag")).toBe(fundCacheTags(fundA, orgIdFor(fundA)));

    const ownerView = await apps.ownerApp.request(`/v1/funds/${fundA}/audit-bundle`);
    expect(ownerView.status).toBe(200);
    expect(ownerView.headers.get("cache-control")).toBe(PRIVATE_READ_CACHE_CONTROL);
    expect(ownerView.headers.get("cache-tag")).toBeNull();
    expect(ownerView.headers.get("etag")).toBeNull();
  });
});
