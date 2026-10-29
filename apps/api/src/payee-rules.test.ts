import { type PseudonymId, parsePseudonymId } from "@yen/eventlog";
import { createDraftRequest, InMemoryExpenseStore } from "@yen/ledger";
import { createUnverifiedPayee } from "@yen/policy";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { type AppDependencies, MemoryFundStore, type Principal } from "./dependencies.js";
import { MemoryPayeeProfileStore } from "./payee-rules/profile-store.js";
import { fingerprintPayee } from "./payee-rules/service.js";
import {
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  MemoryPinStore,
  PinService,
} from "./pin/index.js";
import { devPolicy, type FundRecord } from "./policy.js";

const FUND_ID = "00000000-0000-4000-8000-000000000001";
const SALT = "x".repeat(40);
const MEMBER_USER_ID = "00000000-0000-4000-8000-000000000010";
const OWNER_USER_ID = "00000000-0000-4000-8000-000000000011";
const requester = parsePseudonymId("psn_00000000-0000-4000-8000-000000000020");
const officeholder = parsePseudonymId("psn_00000000-0000-4000-8000-000000000021");
const member = parsePseudonymId("psn_00000000-0000-4000-8000-000000000022");

const privateFund: FundRecord = {
  owner: OWNER_USER_ID,
  fund: {
    name: "Private fund",
    purpose: "Member expense test",
    targetPaise: "5000000",
    upiVpa: "fund@yenbank",
    upiPayeeName: "Private Fund",
    visibility: "private",
    id: FUND_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
};

function makeFundStore() {
  const store = new MemoryFundStore();
  store.set(FUND_ID, privateFund);
  return store;
}

function makeRequest(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  return new Request(`http://localhost${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function baseOverrides(input: {
  readonly principal: Principal;
  readonly actor: PseudonymId;
  readonly payeeProfileStore: MemoryPayeeProfileStore;
  readonly expenseStore?: AppDependencies["expenseStore"];
  readonly pinService?: PinService;
  readonly pinStore?: MemoryPinStore;
  readonly actionTokenStore?: MemoryActionTokenStore;
  readonly pinNotificationService?: MemoryPinNotificationService;
}): Partial<AppDependencies> {
  return {
    principal: input.principal,
    policy: devPolicy,
    fundStore: makeFundStore(),
    payeeProfileStore: input.payeeProfileStore,
    payeeFingerprintSalt: SALT,
    actorForUser: async () => input.actor,
    ...(input.expenseStore ? { expenseStore: input.expenseStore } : {}),
    ...(input.pinService ? { pinService: input.pinService } : {}),
    ...(input.pinStore ? { pinStore: input.pinStore } : {}),
    ...(input.actionTokenStore ? { actionTokenStore: input.actionTokenStore } : {}),
    ...(input.pinNotificationService
      ? { pinNotificationService: input.pinNotificationService }
      : {}),
  };
}

describe("payee rule API and member profiles", () => {
  it("evaluates and attaches member-visible fraud flags at submission time", async () => {
    const profileStore = new MemoryPayeeProfileStore();
    const payeeIdentity = { kind: "upi" as const, vpa: "requester@yenbank" };
    const fingerprint = fingerprintPayee(FUND_ID, payeeIdentity, SALT);
    expect(fingerprintPayee("00000000-0000-4000-8000-000000000002", payeeIdentity, SALT)).not.toBe(
      fingerprint,
    );
    profileStore.set({
      fundId: FUND_ID,
      memberPseudonym: requester,
      fingerprint,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const expenseStore = new InMemoryExpenseStore();
    const app = createApp({
      ...baseOverrides({
        principal: { id: OWNER_USER_ID, role: "owner" },
        actor: requester,
        payeeProfileStore: profileStore,
        expenseStore,
      }),
      clock: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    const create = await app.request(
      makeRequest(
        `/v1/funds/${FUND_ID}/expenses`,
        "POST",
        {
          amountPaise: "150000",
          description: "Member reimbursement",
          recipientRef: "requester@yenbank",
          payee: { identity: payeeIdentity, name: "Requester" },
        },
        { "Idempotency-Key": "self-payee-create" },
      ),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { readonly id: string };
    const submitted = await app.request(
      makeRequest(`/v1/funds/${FUND_ID}/expenses/${created.id}/submit`, "POST", undefined, {
        "Idempotency-Key": "self-payee-submit",
      }),
    );
    expect(submitted.status).toBe(200);
    const result = (await submitted.json()) as {
      readonly fraudFlags: readonly { readonly code: string; readonly reason: string }[];
    };
    expect(result.fraudFlags.map((flag) => flag.code)).toEqual([
      "new_payee_large_first_payment",
      "self_payment",
    ]);
    expect((await expenseStore.get(created.id))?.fraudFlags).toEqual(result.fraudFlags);
  });

  it("uses the requester's existing fund display name when no payee profile exists", async () => {
    const profileStore = new MemoryPayeeProfileStore();
    profileStore.setMemberDisplayName(FUND_ID, requester, "Member Requester");
    const expenseStore = new InMemoryExpenseStore();
    const app = createApp({
      ...baseOverrides({
        principal: { id: OWNER_USER_ID, role: "owner" },
        actor: requester,
        payeeProfileStore: profileStore,
        expenseStore,
      }),
      clock: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    const create = await app.request(
      makeRequest(
        `/v1/funds/${FUND_ID}/expenses`,
        "POST",
        {
          amountPaise: "50000",
          description: "Member reimbursement",
          recipientRef: "member-requester@yenbank",
          payee: {
            identity: { kind: "upi", vpa: "member-requester@yenbank" },
            name: " member   requester ",
          },
        },
        { "Idempotency-Key": "requester-name-create" },
      ),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { readonly id: string };
    const submitted = await app.request(
      makeRequest(`/v1/funds/${FUND_ID}/expenses/${created.id}/submit`, "POST", undefined, {
        "Idempotency-Key": "requester-name-submit",
      }),
    );
    expect(submitted.status).toBe(200);
    const result = (await submitted.json()) as {
      readonly fraudFlags: readonly { readonly code: string; readonly reason: string }[];
    };
    const selfPayment = result.fraudFlags.find((flag) => flag.code === "self_payment");
    expect(selfPayment?.reason).toContain("requester-only comparison was used");
    expect(await profileStore.getFingerprint(FUND_ID, requester)).toBeNull();
  });

  it("stores only the normalized identity fingerprint and exposes only set and clear", async () => {
    const profileStore = new MemoryPayeeProfileStore();
    profileStore.setActiveMember(FUND_ID, member, true);
    const app = createApp({
      ...baseOverrides({
        principal: { id: MEMBER_USER_ID, role: "member" },
        actor: member,
        payeeProfileStore: profileStore,
      }),
    });
    const rawVpa = "  MyClub@YenBank  ";
    const set = await app.request(
      makeRequest(
        `/v1/funds/${FUND_ID}/members/${member}/payee-profile`,
        "PUT",
        {
          identity: { kind: "upi", vpa: rawVpa },
          name: "Club account",
        },
        { "Idempotency-Key": "profile-set" },
      ),
    );
    expect(set.status).toBe(200);
    const responseText = await set.text();
    expect(responseText).not.toContain(rawVpa);
    expect(responseText).not.toContain("myclub@yenbank");
    const expected = fingerprintPayee(FUND_ID, { kind: "upi", vpa: "myclub@yenbank" }, SALT);
    expect(await profileStore.getFingerprint(FUND_ID, member)).toBe(expected);
    expect(JSON.stringify(await profileStore.getFingerprint(FUND_ID, member))).not.toContain(
      "myclub@yenbank",
    );

    const listing = await app.request(`/v1/funds/${FUND_ID}/members/${member}/payee-profile`);
    expect(listing.status).toBe(404);
    const cleared = await app.request(
      makeRequest(`/v1/funds/${FUND_ID}/members/${member}/payee-profile`, "DELETE", undefined, {
        "Idempotency-Key": "profile-clear",
      }),
    );
    expect(cleared.status).toBe(200);
    expect(await profileStore.getFingerprint(FUND_ID, member)).toBeNull();
  });

  it("lets an owner set an officeholder profile but denies other-member writes", async () => {
    const profileStore = new MemoryPayeeProfileStore();
    profileStore.setOfficeholder(FUND_ID, officeholder, true);
    const ownerApp = createApp({
      ...baseOverrides({
        principal: { id: OWNER_USER_ID, role: "owner" },
        actor: requester,
        payeeProfileStore: profileStore,
      }),
    });
    const body = {
      identity: { kind: "bank", account: "1234 567890", ifsc: "abcd 0123456" },
      name: "Treasurer",
    };
    const set = await ownerApp.request(
      makeRequest(`/v1/funds/${FUND_ID}/members/${officeholder}/payee-profile`, "PUT", body, {
        "Idempotency-Key": "owner-officeholder-set",
      }),
    );
    expect(set.status).toBe(200);
    expect(await profileStore.getFingerprint(FUND_ID, officeholder)).toBe(
      fingerprintPayee(FUND_ID, { kind: "bank", account: "1234567890", ifsc: "ABCD0123456" }, SALT),
    );

    const memberApp = createApp({
      ...baseOverrides({
        principal: { id: MEMBER_USER_ID, role: "member" },
        actor: member,
        payeeProfileStore: profileStore,
      }),
    });
    const denied = await memberApp.request(
      makeRequest(`/v1/funds/${FUND_ID}/members/${officeholder}/payee-profile`, "PUT", body, {
        "Idempotency-Key": "member-officeholder-set",
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("PIN-gates payee changes and evaluates active member fingerprints", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const profileStore = new MemoryPayeeProfileStore();
    const payeeInput = { kind: "upi" as const, vpa: "self@yenbank" };
    const fingerprint = fingerprintPayee(FUND_ID, payeeInput, SALT);
    profileStore.set({
      fundId: FUND_ID,
      memberPseudonym: officeholder,
      fingerprint,
      updatedAt: new Date(now).toISOString(),
    });
    const expenseStore = new InMemoryExpenseStore();
    const existingPayee = createUnverifiedPayee({
      identity: { kind: "upi", vpa: "old@yenbank" },
      name: "Old supplier",
    });
    const expense = {
      ...createDraftRequest({
        id: "00000000-0000-4000-8000-000000000030",
        fundId: FUND_ID,
        requesterId: requester,
        amountPaise: paise(150_000),
        description: "Membership refund",
        recipientRef: "old supplier",
        createdAt: new Date(now).toISOString(),
      }),
      payee: existingPayee,
      payeeFingerprint: fingerprintPayee(FUND_ID, existingPayee.identity, SALT),
    };
    await expenseStore.save(expense);
    const pinStore = new MemoryPinStore({ clock: () => now });
    const actionTokenStore = new MemoryActionTokenStore({ clock: () => now });
    const notificationService = new MemoryPinNotificationService();
    const pinSecret = "p".repeat(40);
    const pinService = new PinService({
      pinStore,
      actionTokenStore,
      notificationService,
      pinSecret,
      otpVerifier: null,
      clock: () => now,
    });
    await pinService.setupPin(OWNER_USER_ID, "482915", { userId: OWNER_USER_ID });
    const app = createApp({
      ...baseOverrides({
        principal: { id: OWNER_USER_ID, role: "owner" },
        actor: requester,
        payeeProfileStore: profileStore,
        expenseStore,
        pinService,
        pinStore,
        actionTokenStore,
        pinNotificationService: notificationService,
      }),
      clock: () => now,
    });
    const route = `/v1/funds/${FUND_ID}/expenses/${expense.id}/payee`;
    const changed = await app.request(
      makeRequest(
        route,
        "PUT",
        { identity: payeeInput, name: "Self" },
        {
          "Idempotency-Key": "payee-change",
          "x-approval-pin": "482915",
        },
      ),
    );
    expect(changed.status).toBe(200);
    const result = (await changed.json()) as {
      readonly payee: { readonly verification: { readonly status: string } };
      readonly fraudFlags: readonly { readonly code: string; readonly reason: string }[];
    };
    expect(result.payee.verification.status).toBe("unverified");
    expect(result.fraudFlags.map((flag) => flag.code)).toContain("self_payment");
    expect(result.fraudFlags.find((flag) => flag.code === "self_payment")?.reason).toContain(
      "requester has no payee profile",
    );
    expect(JSON.stringify(result)).not.toContain(fingerprint);
    expect((await expenseStore.get(expense.id))?.fraudFlags).toEqual(result.fraudFlags);

    now += 1;
    const noPin = await app.request(
      makeRequest(
        route,
        "PUT",
        { identity: payeeInput, name: "Self" },
        { "Idempotency-Key": "payee-change-no-pin" },
      ),
    );
    expect(noPin.status).toBe(403);
  });
});
