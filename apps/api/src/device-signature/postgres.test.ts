import { randomInt, randomUUID } from "node:crypto";
import { migrate } from "@yen/db";
import { parsePseudonymId } from "@yen/eventlog";
import { createDraftRequest, InMemoryExpenseStore, submitExpense } from "@yen/ledger";
import { paise } from "@yen/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../../packages/db/src/test/database.js";
import { createSoftwareAuthenticator } from "../../scripts/software-authenticator-fixture.js";
import { createApp } from "../app.js";
import { MemoryFundStore } from "../dependencies.js";
import { computeActionHash } from "../pin/crypto.js";
import {
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  PinService,
  PostgresPinStore,
} from "../pin/index.js";
import { devPolicy } from "../policy.js";
import { DeviceSignatureService } from "./service.js";
import { PostgresDeviceSignatureStore } from "./store.js";

const RP_ID = "yen.test";
const ORIGIN = "https://yen.test";
const PIN = "482915";
const PIN_SECRET = "test_pin_hmac_secret_32_bytes_long_env_kms";
const EXPENSE_POLICY = { approvalQuorum: 2, objectionWindowHours: 0, autoExpireHours: 0 } as const;

databaseSuite("Postgres WebAuthn device signatures", (sql) => {
  let now = Date.now();

  beforeAll(async () => {
    await migrate(sql);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function harness(options: { readonly expenseStore?: InMemoryExpenseStore } = {}) {
    const userId = randomUUID();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'WebAuthn Test')`;
    const pinStore = new PostgresPinStore(sql);
    const actionTokenStore = new MemoryActionTokenStore({ clock: () => now });
    const pinNotificationService = new MemoryPinNotificationService();
    const deviceSignatureStore = new PostgresDeviceSignatureStore(sql);
    const deviceSignatureConfig = { rpId: RP_ID, origin: ORIGIN, rpName: "Yen Test" };
    const deviceSignatureService = new DeviceSignatureService({
      store: deviceSignatureStore,
      config: deviceSignatureConfig,
      clock: () => now,
    });
    const pinService = new PinService({
      pinStore,
      actionTokenStore,
      notificationService: pinNotificationService,
      pinSecret: PIN_SECRET,
      otpVerifier: null,
      clock: () => now,
    });
    await pinService.setupPin(userId, PIN);
    const app = createApp({
      principal: { id: userId, role: "approver" },
      policy: devPolicy,
      expenseStore: options.expenseStore ?? new InMemoryExpenseStore(),
      pinStore,
      actionTokenStore,
      pinNotificationService,
      pinSecret: PIN_SECRET,
      pinService,
      clock: () => now,
      deviceSignatureStore,
      deviceSignatureConfig,
      deviceSignatureService,
      logger: { log: () => undefined },
    });
    return {
      userId,
      app,
      pinService,
      deviceSignatureService,
      deviceSignatureStore,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  async function register(
    h: Awaited<ReturnType<typeof harness>>,
    options: { readonly pin?: string } = {},
  ) {
    const response = await h.app.request(
      new Request(`${ORIGIN}/v1/auth/device-credentials/registration/options`, { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const creationOptions = (await response.json()) as { challenge: string };
    const authenticator = createSoftwareAuthenticator(RP_ID);
    const registrationResponse = authenticator.registration(creationOptions.challenge, ORIGIN);
    const verify = await h.app.request(
      new Request(`${ORIGIN}/v1/auth/device-credentials/registration/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Test phone",
          pin: options.pin ?? PIN,
          response: registrationResponse,
        }),
      }),
    );
    return { verify, authenticator };
  }

  async function assertionOptions(app: ReturnType<typeof createApp>, actionHash: string) {
    const response = await app.request(
      new Request(`${ORIGIN}/v1/auth/device-signatures/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionHash }),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { challenge: string };
  }

  it("registers with a fresh PIN and verifies action-bound, one-use signatures", async () => {
    const h = await harness();
    const rejectedRegistration = await register(h, { pin: "111111" });
    expect(rejectedRegistration.verify.status).toBe(403);
    expect(await h.deviceSignatureStore.listCredentials(h.userId)).toHaveLength(0);
    const { verify, authenticator } = await register(h);
    expect(verify.status).toBe(201);
    expect(((await verify.json()) as { label: string }).label).toBe("Test phone");
    expect(await h.deviceSignatureStore.listCredentials(h.userId)).toHaveLength(1);

    const actionHash = "a".repeat(64);
    const wrongActionHash = "b".repeat(64);
    const wrongActionOptions = await h.deviceSignatureService.assertionOptions(
      h.userId,
      actionHash,
    );
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        wrongActionHash,
        authenticator.assertion(wrongActionOptions.challenge, ORIGIN, 1),
      ),
    ).rejects.toMatchObject({ reason: "wrong_action" });

    const options = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    const assertion = authenticator.assertion(options.challenge, ORIGIN, 1);
    const proof = await h.deviceSignatureService.verifyAssertion(h.userId, actionHash, assertion);
    expect(proof.deviceProof).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      h.deviceSignatureService.consumeProof(h.userId, wrongActionHash, proof.deviceProof),
    ).rejects.toMatchObject({ reason: "wrong_action" });
    expect(
      await h.deviceSignatureService.consumeProof(h.userId, actionHash, proof.deviceProof),
    ).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      h.deviceSignatureService.consumeProof(h.userId, actionHash, proof.deviceProof),
    ).rejects.toMatchObject({ reason: "replayed" });
    await expect(
      h.deviceSignatureService.verifyAssertion(h.userId, actionHash, assertion),
    ).rejects.toMatchObject({ reason: "replayed" });

    const regressionOptions = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        actionHash,
        authenticator.assertion(regressionOptions.challenge, ORIGIN, 1),
      ),
    ).rejects.toMatchObject({ reason: "counter_regression" });
  });

  it("rejects wrong origins, expired challenges and revoked credentials with distinct reasons", async () => {
    const h = await harness();
    const { verify, authenticator } = await register(h);
    expect(verify.status).toBe(201);
    const actionHash = "c".repeat(64);

    const wrongRpId = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        actionHash,
        authenticator.assertion(wrongRpId.challenge, ORIGIN, 1, "attacker.test"),
      ),
    ).rejects.toMatchObject({ reason: "wrong_rp_id" });

    const wrongOrigin = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        actionHash,
        authenticator.assertion(wrongOrigin.challenge, "https://attacker.test", 1),
      ),
    ).rejects.toMatchObject({ reason: "wrong_origin" });

    const expired = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    h.advance(60_001);
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        actionHash,
        authenticator.assertion(expired.challenge, ORIGIN, 1),
      ),
    ).rejects.toMatchObject({ reason: "expired" });

    const revoked = await h.deviceSignatureService.assertionOptions(h.userId, actionHash);
    const revokeResponse = await h.app.request(
      new Request(`${ORIGIN}/v1/auth/device-credentials/${authenticator.credentialId}`, {
        method: "DELETE",
      }),
    );
    expect(revokeResponse.status).toBe(200);
    await expect(
      h.deviceSignatureService.verifyAssertion(
        h.userId,
        actionHash,
        authenticator.assertion(revoked.challenge, ORIGIN, 1),
      ),
    ).rejects.toMatchObject({ reason: "revoked_credential" });
    expect((await h.deviceSignatureStore.listCredentials(h.userId))[0]?.revokedAt).not.toBeNull();
    const listResponse = await h.app.request(
      new Request(`${ORIGIN}/v1/auth/device-credentials`, { method: "GET" }),
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      credentials: { revokedAt: string | null }[];
    };
    expect(listed.credentials[0]?.revokedAt).not.toBeNull();
  });

  it("requires a device proof above the fund threshold and records its credential hash", async () => {
    const expenseStore = new InMemoryExpenseStore();
    const fundId = randomUUID();
    const h = await harness({ expenseStore });
    const { verify, authenticator } = await register(h);
    expect(verify.status).toBe(201);

    const fundStore = new MemoryFundStore();
    const fund = {
      id: fundId,
      name: "Device threshold test",
      targetPaise: "100000",
      upiVpa: "club@bank",
      upiPayeeName: "Test Club",
      visibility: "private" as const,
      createdAt: new Date(now).toISOString(),
    };
    fundStore.set(fundId, { owner: h.userId, fund });
    const app = createApp({
      principal: { id: h.userId, role: "approver" },
      policy: devPolicy,
      expenseStore,
      fundStore,
      pinStore: new PostgresPinStore(sql),
      actionTokenStore: new MemoryActionTokenStore({ clock: () => now }),
      pinSecret: PIN_SECRET,
      pinService: h.pinService,
      clock: () => now,
      deviceSignatureStore: new PostgresDeviceSignatureStore(sql),
      deviceSignatureConfig: { rpId: RP_ID, origin: ORIGIN, rpName: "Yen Test" },
      deviceSignatureService: h.deviceSignatureService,
      logger: { log: () => undefined },
    });
    async function submittedExpense() {
      const expenseId = randomUUID();
      const draft = createDraftRequest({
        id: expenseId,
        fundId,
        requesterId: parsePseudonymId(`psn_${randomUUID()}`),
        amountPaise: paise(500),
        description: "Threshold controlled expense",
        recipientRef: "supplier-1",
        createdAt: new Date(now - 1000).toISOString(),
      });
      await expenseStore.save(
        submitExpense(draft, {
          holdId: randomUUID(),
          policy: EXPENSE_POLICY,
          nowUtc: new Date(now - 500).toISOString(),
        }),
      );
      return expenseId;
    }
    const defaultExpenseId = await submittedExpense();
    const defaultApproval = await app.request(
      new Request(`${ORIGIN}/v1/funds/${fundId}/expenses/${defaultExpenseId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "device-threshold-off" },
        body: JSON.stringify({ pin: PIN }),
      }),
    );
    expect(defaultApproval.status).toBe(200);
    expect((await expenseStore.get(defaultExpenseId))?.approvals[0]?.deviceSignaturePresent).toBe(
      false,
    );

    const policyResponse = await app.request(
      new Request(`${ORIGIN}/v1/funds/${fundId}/policy`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "device-threshold-policy",
        },
        body: JSON.stringify({ pin: PIN, policyJson: { requireDeviceSignatureAbove: 100 } }),
      }),
    );
    expect(policyResponse.status).toBe(200);
    expect((await fundStore.getPolicy(fundId))?.requireDeviceSignatureAbove).toBe(100);
    const expenseId = await submittedExpense();

    const approvalUrl = `${ORIGIN}/v1/funds/${fundId}/expenses/${expenseId}/approve`;
    const withoutProof = await app.request(
      new Request(approvalUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "threshold-no-device" },
        body: JSON.stringify({ pin: PIN }),
      }),
    );
    expect(withoutProof.status).toBe(403);

    const actionHash = computeActionHash({
      action: "expense:approve",
      fundId,
      targetId: expenseId,
    });
    const options = await assertionOptions(app, actionHash);
    const assertionResponse = await app.request(
      new Request(`${ORIGIN}/v1/auth/device-signatures/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionHash,
          response: authenticator.assertion(options.challenge, ORIGIN, 1),
        }),
      }),
    );
    expect(assertionResponse.status).toBe(200);
    const { deviceProof } = (await assertionResponse.json()) as { deviceProof: string };
    const withoutPin = await app.request(
      new Request(approvalUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "threshold-no-pin" },
        body: JSON.stringify({ deviceProof }),
      }),
    );
    expect(withoutPin.status).toBe(403);
    const approved = await app.request(
      new Request(approvalUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "threshold-device" },
        body: JSON.stringify({ pin: PIN, deviceProof }),
      }),
    );
    expect(approved.status).toBe(200);
    const saved = await expenseStore.get(expenseId);
    expect(saved?.approvals[0]).toMatchObject({
      deviceSignaturePresent: true,
      credentialIdHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("counts failed assertions against the persisted PIN lockout budget", async () => {
    const h = await harness();
    const { verify, authenticator } = await register(h);
    expect(verify.status).toBe(201);
    const actionHash = "d".repeat(64);

    for (let attempt = 0; attempt < 5; attempt++) {
      const options = await assertionOptions(h.app, actionHash);
      const response = await h.app.request(
        new Request(`${ORIGIN}/v1/auth/device-signatures/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actionHash,
            response: authenticator.assertion(
              options.challenge,
              "https://wrong-origin.test",
              attempt + 1,
            ),
          }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { details: { message: string }[] } };
      expect(body.error.details[0]?.message).toBe("Device signature could not be verified");
      if (attempt === 1) {
        const validOptions = await assertionOptions(h.app, actionHash);
        const valid = await h.app.request(
          new Request(`${ORIGIN}/v1/auth/device-signatures/verify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              actionHash,
              response: authenticator.assertion(validOptions.challenge, ORIGIN, 1),
            }),
          }),
        );
        expect(valid.status).toBe(200);
        // A valid device signature does not clear PIN failures: PIN remains mandatory.
        expect((await new PostgresPinStore(sql).get(h.userId))?.failedAttempts).toBe(2);
      }
    }
    expect((await h.pinService.getPinStatus(h.userId)).status).toBe("rate_limited");
    expect((await new PostgresPinStore(sql).get(h.userId))?.failedAttempts).toBe(5);
  });
});
