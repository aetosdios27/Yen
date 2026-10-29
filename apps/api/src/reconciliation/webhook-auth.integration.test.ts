import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { migrate } from "@yen/db";
import { beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../../../packages/db/src/test/database.js";
import { createApp } from "../app.js";
import { PostgresIdempotencyStore, PostgresRateLimitStore } from "../postgres-stores.js";
import { PostgresReconciliationStore } from "./postgres-store.js";

const primarySecret = randomBytes(32).toString("hex");
const secondarySecret = randomBytes(32).toString("hex");

function signed(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

databaseSuite("partner webhook authentication with Postgres", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  function setup(
    options: {
      secret?: string | null;
      secondarySecret?: string | null;
      ipCapacity?: number;
      ipAddress?: string;
    } = {},
  ) {
    const app = createApp({
      clock: Date.now,
      logger: { log: () => undefined },
      reconciliationStore: new PostgresReconciliationStore(sql),
      idempotencyStore: new PostgresIdempotencyStore(sql),
      rateLimitStore: new PostgresRateLimitStore(sql),
      ...(options.ipCapacity === undefined
        ? {}
        : {
            rateLimits: {
              ip: { capacity: options.ipCapacity, refillMs: 60_000 },
              principal: { capacity: 60, refillMs: 60_000 },
            },
          }),
      clientIp: () => options.ipAddress ?? "unknown",
      partnerWebhookSecret: options.secret === undefined ? primarySecret : options.secret,
      partnerWebhookSecondarySecret: options.secondarySecret ?? null,
      partnerWebhookToleranceSeconds: 300,
    });
    return app;
  }

  function payload(bankReference = `webhook-${randomUUID()}`) {
    return JSON.stringify({
      event: "virtual_account.credited",
      timestamp: new Date().toISOString(),
      data: {
        fund_id: randomUUID(),
        bank_reference: bankReference,
        amount_paise: 74001,
        type: "credit",
        posted_at: new Date().toISOString(),
        utr: "998877665544",
      },
    });
  }

  async function countReference(bankReference: string): Promise<number> {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM bank_transactions WHERE bank_reference = ${bankReference}
    `;
    return rows[0]?.count ?? 0;
  }

  async function send(
    app: ReturnType<typeof setup>,
    body: string,
    timestamp: string,
    signature: string | undefined,
  ) {
    return app.request("/v1/reconciliation/webhooks/partner", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Yen-Timestamp": timestamp,
        ...(signature === undefined ? {} : { "X-Yen-Signature": signature }),
      },
      body,
    });
  }

  async function expectNoIngest(
    app: ReturnType<typeof setup>,
    bankReference: string,
    body: string,
    timestamp: string,
    signature: string | undefined,
    status = 401,
  ) {
    const before = await countReference(bankReference);
    const response = await send(app, body, timestamp, signature);
    expect(response.status).toBe(status);
    expect(await countReference(bankReference)).toBe(before);
  }

  describe("signature verification", () => {
    it("ingests a valid signature and rejects replay without adding another row", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signed(primarySecret, timestamp, body);
      const accepted = await send(app, body, timestamp, signature);
      expect(accepted.status).toBe(200);
      expect(await countReference(reference)).toBe(1);

      const replay = await send(app, body, timestamp, signature);
      expect(replay.status).toBe(409);
      expect(await countReference(reference)).toBe(1);
    });

    it.each([
      ["missing signature", undefined],
      ["invalid signature", "invalid"],
      ["short signature", "v1=abcd"],
      ["wrong-length signature", `v1=${randomBytes(33).toString("hex")}`],
    ])("rejects %s without ingestion", async (_name, signature) => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(app, reference, body, timestamp, signature);
    });

    it("rejects a stale timestamp without ingestion", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000) - 301);
      await expectNoIngest(app, reference, body, timestamp, signed(primarySecret, timestamp, body));
    });

    it("rejects a future timestamp without ingestion", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000) + 301);
      await expectNoIngest(app, reference, body, timestamp, signed(primarySecret, timestamp, body));
    });

    it("rejects a tampered body without ingestion", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const signedBody = payload(reference);
      const changedBody = signedBody.replace("74001", "74002");
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(
        app,
        reference,
        changedBody,
        timestamp,
        signed(primarySecret, timestamp, signedBody),
      );
    });

    it("rejects oversized bodies without ingestion", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = `${payload(reference)}\n${" ".repeat(65536)}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(
        app,
        reference,
        body,
        timestamp,
        signed(primarySecret, timestamp, body),
        413,
      );
    });

    it("rejects a signature from the wrong secret without ingestion", async () => {
      const app = setup();
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(
        app,
        reference,
        body,
        timestamp,
        signed(randomBytes(32).toString("hex"), timestamp, body),
      );
    });

    it("accepts the secondary secret during rotation", async () => {
      const app = setup({ secondarySecret });
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await send(app, body, timestamp, signed(secondarySecret, timestamp, body));
      expect(response.status).toBe(200);
      expect(await countReference(reference)).toBe(1);
    });

    it("fails closed with 503 when no secret is configured", async () => {
      const app = setup({ secret: null });
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(app, reference, body, timestamp, undefined, 503);
    });

    it("uses the shared per-IP rate limiter", async () => {
      const app = setup({ ipCapacity: 1, ipAddress: "198.51.100.102" });
      const reference = `webhook-${randomUUID()}`;
      const body = payload(reference);
      const timestamp = String(Math.floor(Date.now() / 1000));
      await expectNoIngest(app, reference, body, timestamp, undefined, 401);
      await expectNoIngest(app, reference, body, timestamp, undefined, 429);
    });
  });
});
