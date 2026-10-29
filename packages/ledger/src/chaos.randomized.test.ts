import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { uuidv7 } from "@yen/db";
import type { DeliveryResult } from "@yen/notifications";
import {
  type ChannelProvider,
  enqueueNotification,
  InMemoryChannelProvider,
  NotificationsWorker,
  PostgresNotificationStore,
} from "@yen/notifications";
import {
  type AnchoringAlert,
  AnchoringWorker,
  type ChainReceipt,
  type Publication,
  type RootChain,
} from "@yen/queue";
import {
  buildIntervalTree,
  hash32,
  paise,
  parseFundId,
  parseUserId,
  salt32,
  toHex,
} from "@yen/shared";
import { expect, it } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import { verifyFundState } from "./chaos.js";
import { getBalances, pledgeDonation, recordDonation } from "./operations.js";
import { createLedgerTestFund, ledgerDatabaseSuite } from "./test/database.js";

class DeterministicChain implements RootChain {
  chainId = 80002n;
  roots = new Map<bigint, string>();
  receipts = new Map<string, ChainReceipt>();
  publications = new Map<bigint, Publication>();
  async getRoot(sequence: bigint) {
    return this.roots.get(sequence) ?? `0x${"0".repeat(64)}`;
  }
  async getReceipt(hash: string) {
    return this.receipts.get(hash) ?? null;
  }
  async getPublication(sequence: bigint) {
    return this.publications.get(sequence) ?? null;
  }
  async getBlockNumber() {
    return 200n;
  }
  async getLatestSequence() {
    return [...this.roots.keys()].reduce(
      (latest, value) =>
        Math.max(Number(latest), Number(value)) === Number(value) ? value : latest,
      0n,
    );
  }
  async publish(root: `0x${string}`, sequence: bigint) {
    const txHash = `0x${sequence.toString(16).padStart(64, "0")}`;
    this.roots.set(sequence, root);
    this.publications.set(sequence, { txHash, blockNumber: 100n });
    this.receipts.set(txHash, { status: "success", blockNumber: 100n });
    return txHash;
  }
}

class IdempotentFakeProvider implements ChannelProvider {
  readonly channel = "whatsapp" as const;
  readonly costPerMessagePaise = paise(0);
  readonly effects = new Set<string>();
  readonly attempts = new Map<string, number>();
  failAfterFirstEffect = false;
  async send(input: Parameters<ChannelProvider["send"]>[0]): Promise<DeliveryResult> {
    this.attempts.set(input.idempotencyKey, (this.attempts.get(input.idempotencyKey) ?? 0) + 1);
    const first = !this.effects.has(input.idempotencyKey);
    this.effects.add(input.idempotencyKey);
    if (first && this.failAfterFirstEffect) {
      this.failAfterFirstEffect = false;
      throw new Error("injected worker termination after provider accepted message");
    }
    return {
      success: true,
      channel: this.channel,
      cost_paise: paise(0),
      provider_message_id: input.idempotencyKey,
    };
  }
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const enabled = process.env.YEN_RUN_1000_CHAOS === "1";
ledgerDatabaseSuite("YEN-61 real randomized crash scenarios", (sql) => {
  it.skipIf(!enabled)(
    "runs 1,000 seeded real Postgres scenarios across ledger, outbox, worker, and anchoring",
    async () => {
      const started = Date.now();
      const seed = Number(process.env.YEN_CHAOS_SEED ?? 0x61c0ffee) >>> 0;
      const random = lcg(seed);
      const fundId = await createLedgerTestFund(sql);
      const userRows = await sql<{ owner_id: string }[]>`
      SELECT owner_id FROM orgs WHERE id = (SELECT org_id FROM funds WHERE id = ${fundId})
    `;
      const parsedFund = parseFundId(fundId);
      const parsedUser = parseUserId(userRows[0]?.owner_id ?? "");
      if (!parsedFund.ok || !parsedUser.ok) throw new Error("Could not resolve scenario fund/user");
      const userId = parsedUser.value;
      const notificationStore = new PostgresNotificationStore(sql as never);
      const provider = new IdempotentFakeProvider();
      const unused = new InMemoryChannelProvider("sms");
      await notificationStore.setUserContact(userId, { phone: "+14155550123" });
      await notificationStore.setUserPreferences({
        user_id: userId,
        whatsapp_enabled: true,
        sms_enabled: false,
        email_enabled: false,
        opted_out: false,
        locale: "en",
        quiet_hours_enabled: false,
        quiet_hours_start: "22:00",
        quiet_hours_end: "08:00",
        timezone: "UTC",
      });
      const chain = new DeterministicChain();
      const signer = {
        getAccount: async () => {
          throw new Error("fake chain does not sign");
        },
      };
      const anchorWorker = new AnchoringWorker(sql, chain, signer);
      const verifiedAnchorIds = new Set<string>();
      let verifiedTotal = 0n;
      let crashCount = 0;
      let operationCount = 0;
      let expectedNotifications = 0;
      const crashesByPoint = [0, 0, 0, 0];

      for (let scenario = 0; scenario < 1000; scenario++) {
        const scenarioSeed = (seed + scenario) >>> 0;
        try {
          const steps = 1 + Math.floor(random() * 4);
          const eventsBefore = await sql<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count FROM fund_events WHERE fund_id = ${fundId}
          `;
          let expectedScenarioEvents = 0n;
          for (let step = 0; step < steps; step++) {
            operationCount++;
            const donationId = uuidv7();
            const amount = 100 + Math.floor(random() * 10_000);
            const isVerified = random() < 0.65;
            const crashPoint = Math.floor(random() * 4); // before write, after ledger/event, before commit, or no crash
            const shouldCrash = crashPoint !== 3 && random() < 0.18;
            if (shouldCrash) crashesByPoint[crashPoint] = (crashesByPoint[crashPoint] ?? 0) + 1;
            if (shouldCrash && crashPoint === 0) crashCount++;
            else {
              const transaction = sql.begin(async (tx) => {
                let event: import("@yen/eventlog").Event;
                if (isVerified) {
                  const result = await recordDonation(tx, {
                    fundId,
                    amount: paise(amount),
                    donationId,
                  });
                  event = result.verifiedEvent;
                } else {
                  const result = await pledgeDonation(tx, {
                    fundId,
                    amount: paise(amount),
                    donationId,
                    utr: String((scenario * 4 + step + 1) % 1_000_000_000_000).padStart(12, "0"),
                  });
                  if (result.kind !== "pledged") throw new Error("Unexpected duplicate UTR");
                  event = result.event;
                }
                if (shouldCrash && crashPoint === 1)
                  throw new Error("injected crash after event append");
                await enqueueNotification(tx as never, {
                  fund_id: fundId,
                  user_id: userId,
                  event_id: event.hash,
                  idempotency_key: `chaos:${fundId}:${donationId}`,
                  template_id: "donation_received",
                  template_data: {
                    fund_title: "Chaos Fund",
                    donation_id: donationId,
                    amount_paise: amount,
                  },
                });
                if (shouldCrash && crashPoint === 2)
                  throw new Error("injected crash before commit");
              });
              if (shouldCrash) await expect(transaction).rejects.toThrow("injected crash");
              else await transaction;
              if (shouldCrash) crashCount++;
              else {
                expectedScenarioEvents += isVerified ? 2n : 1n;
                expectedNotifications++;
                if (isVerified) verifiedTotal += BigInt(amount);
              }
            }
          }

          const state = await verifyFundState(sql, fundId);
          expect(state.events.length).toBe(
            Number(eventsBefore[0]?.count ?? 0n) + Number(expectedScenarioEvents),
          );
          expect(state.balances.bankPaise).toBe(verifiedTotal);

          const clock = new Date(Date.now() + scenario * 86_400_000 + 180_000);
          const worker = new NotificationsWorker({
            store: notificationStore,
            whatsappProvider: provider,
            smsProvider: unused,
            clock: () => clock,
            leaseDurationMs: 60_000,
          });
          await worker.processNextBatch();
          const statuses = await sql<{ pending: number; delivered: number; total: number }[]>`
            SELECT COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS pending,
                   COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
                   COUNT(*)::int AS total
            FROM notification_outbox WHERE fund_id = ${fundId}
          `;
          const notificationRows = await sql<
            {
              idempotency_key: string;
              status: string;
              attempts: number;
              last_error: string | null;
            }[]
          >`SELECT idempotency_key, status, attempts, last_error FROM notification_outbox WHERE fund_id = ${fundId}`;
          expect(statuses[0]?.pending, JSON.stringify(notificationRows)).toBe(0);
          expect(statuses[0]?.delivered, JSON.stringify(notificationRows)).toBe(statuses[0]?.total);
          expect(statuses[0]?.total).toBe(expectedNotifications);
          expect(provider.effects.size).toBe(statuses[0]?.total);
          expect(provider.effects).toEqual(
            new Set(notificationRows.map((row) => row.idempotency_key)),
          );
          expect(provider.attempts.size).toBe(statuses[0]?.total);
          expect([...provider.attempts.values()].every((attempts) => attempts === 1)).toBe(true);

          await anchorWorker.runFund(fundId);
          await anchorWorker.runFund(fundId);
          const anchorRows = await sql<
            { id: string; from_seq: bigint; to_seq: bigint; root: string; chain_sequence: bigint }[]
          >`
            SELECT id, from_seq, to_seq, root, chain_sequence FROM anchors WHERE fund_id = ${fundId}
          `;
          expect(new Set(anchorRows.map((row) => `${row.from_seq}:${row.to_seq}`)).size).toBe(
            anchorRows.length,
          );
          expect(anchorRows.every((row) => row.root.length === 64)).toBe(true);
          for (const anchor of anchorRows) {
            expect(chain.roots.get(anchor.chain_sequence)).toBe(`0x${anchor.root}`);
            if (verifiedAnchorIds.has(anchor.id)) continue;
            const material = await sql<{ seq: bigint; hash: string; salt: string }[]>`
              SELECT e.seq, e.hash, s.salt
              FROM fund_events e
              JOIN anchor_event_salts s ON s.fund_id = e.fund_id AND s.seq = e.seq
              WHERE s.anchor_id = ${anchor.id}
              ORDER BY e.seq
            `;
            expect(material.length).toBe(Number(anchor.to_seq - anchor.from_seq + 1n));
            const events = material.map((row) => ({
              seq: Number(row.seq),
              eventHash: hash32(Buffer.from(row.hash, "hex")),
              salt: salt32(Buffer.from(row.salt, "hex")),
            }));
            const tail = events.at(-1);
            if (!tail) throw new Error(`Anchor ${anchor.id} has no event salts`);
            const tree = await buildIntervalTree([
              { fundId: parsedFund.value, latestEventHash: tail.eventHash, events },
            ]);
            expect(toHex(tree.root)).toBe(anchor.root);
            verifiedAnchorIds.add(anchor.id);
          }
          const confirmed = await getBalances(sql, fundId);
          expect(confirmed.bankPaise).toBe(verifiedTotal);
        } catch (error) {
          throw new Error(
            `scenario=${scenario} seed=${scenarioSeed} rootSeed=${seed}: ${String(error)}`,
            { cause: error },
          );
        }
      }
      await anchorWorker.runFund(fundId);
      await anchorWorker.runFund(fundId);
      const anchors = await sql<{ id: string }[]>`SELECT id FROM anchors WHERE fund_id = ${fundId}`;
      expect(verifiedAnchorIds.size).toBe(anchors.length);
      const finalState = await verifyFundState(sql, fundId);
      expect(finalState.balances.bankPaise).toBe(verifiedTotal);
      const eventCount = await sql<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM fund_events WHERE fund_id = ${fundId}
      `;
      const maxAnchor = await sql<{ to_seq: bigint | null }[]>`
        SELECT MAX(to_seq) AS to_seq FROM anchors WHERE fund_id = ${fundId}
      `;
      expect(maxAnchor[0]?.to_seq).toBe(eventCount[0]?.count);
      process.stdout.write(
        `REAL CHAOS PASS scenarios=1000 seed=${seed} operations=${operationCount} injectedCrashes=${crashCount} crashPoints=before-write:${crashesByPoint[0]},after-event:${crashesByPoint[1]},before-commit:${crashesByPoint[2]} violations=0 durationMs=${Date.now() - started}\n`,
      );
    },
    900_000,
  );
});

ledgerDatabaseSuite("YEN-61 real notification crash points and chain outage", (sql, url) => {
  it("recovers claimed, post-provider, and status-recorded notification kills without duplicate effects", async () => {
    const fundId = await createLedgerTestFund(sql);
    const users = await sql<
      { owner_id: string }[]
    >`SELECT owner_id FROM orgs WHERE id = (SELECT org_id FROM funds WHERE id = ${fundId})`;
    const user = parseUserId(users[0]?.owner_id ?? "");
    if (!user.ok) throw new Error("Invalid test identifiers");
    const store = new PostgresNotificationStore(sql as never);
    await store.setUserContact(user.value, { phone: "+14155550123" });
    await store.setUserPreferences({
      user_id: user.value,
      whatsapp_enabled: true,
      sms_enabled: false,
      email_enabled: false,
      opted_out: false,
      locale: "en",
      quiet_hours_enabled: false,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      timezone: "UTC",
    });
    await sql`CREATE TABLE yen61_provider_calls (id bigserial PRIMARY KEY, idempotency_key text NOT NULL)`;
    await sql`CREATE TABLE yen61_provider_effects (idempotency_key text PRIMARY KEY)`;
    const killPoints = ["claimed", "sent-to-provider", "status-recorded"] as const;
    for (const point of killPoints) {
      const id = uuidv7();
      await enqueueNotification(sql as never, {
        fund_id: fundId,
        user_id: user.value,
        idempotency_key: `kill:${point}:${id}`,
        template_id: "donation_received",
        template_data: { fund_title: "Kill Fund", donation_id: id, amount_paise: 123 },
      });
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../../packages/notifications/scripts/notification-kill-worker.mjs",
              import.meta.url,
            ),
          ),
        ],
        {
          env: { ...process.env, YEN_TEST_DATABASE_URL: url, YEN_CHAOS_KILL_POINT: point },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let childErrors = "";
      child.stderr.on("data", (chunk: Buffer) => {
        childErrors += chunk.toString("utf8");
      });
      const marker = new Promise<void>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error(`child did not reach ${point}: ${childErrors}`)),
          15_000,
        );
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (output.includes(`CHAOS_KILL_POINT:${point}`)) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timeout);
          reject(
            new Error(`child exited before ${point}: code=${code} signal=${signal} ${childErrors}`),
          );
        });
      });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => child.once("close", (code, signal) => resolve({ code, signal })),
      );
      try {
        await marker;
      } catch (error) {
        child.kill("SIGKILL");
        await closed;
        throw error;
      }
      child.kill("SIGKILL");
      expect((await closed).signal).toBe("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 350));

      const recoveryProvider: ChannelProvider = {
        channel: "whatsapp",
        costPerMessagePaise: paise(0),
        async send(input) {
          await sql`INSERT INTO yen61_provider_calls (idempotency_key) VALUES (${input.idempotencyKey})`;
          await sql`
            INSERT INTO yen61_provider_effects (idempotency_key)
            VALUES (${input.idempotencyKey}) ON CONFLICT (idempotency_key) DO NOTHING
          `;
          return {
            success: true,
            channel: "whatsapp",
            cost_paise: paise(0),
            provider_message_id: input.idempotencyKey,
          };
        },
      };
      const recovery = new NotificationsWorker({
        store,
        whatsappProvider: recoveryProvider,
        smsProvider: recoveryProvider,
        leaseDurationMs: 60_000,
      });
      await recovery.processNextBatch();
      const row = await sql<
        { status: string; attempts: number; last_error: string | null }[]
      >`SELECT status, attempts, last_error FROM notification_outbox WHERE idempotency_key = ${`kill:${point}:${id}`}`;
      expect(row[0]?.status, JSON.stringify(row[0])).toBe("delivered");
      const calls = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM yen61_provider_calls WHERE idempotency_key = ${`kill:${point}:${id}`}
      `;
      const effects = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM yen61_provider_effects WHERE idempotency_key = ${`kill:${point}:${id}`}
      `;
      expect(effects[0]?.count).toBe(1);
      expect(calls[0]?.count).toBe(point === "sent-to-provider" ? 2 : 1);
    }
  });

  it("alerts and retries through chain RPC outage, then drains one durable anchor on recovery", async () => {
    const fundId = await createLedgerTestFund(sql);
    await sql.begin((tx) => recordDonation(tx, { fundId, amount: paise(1000) }));
    const alerts: AnchoringAlert[] = [];
    const chain = new DeterministicChain();
    let down = true;
    const outageChain: RootChain = {
      chainId: chain.chainId,
      getRoot: (sequence) => chain.getRoot(sequence),
      getReceipt: (hash) => chain.getReceipt(hash),
      getPublication: (sequence) => chain.getPublication(sequence),
      getBlockNumber: () => chain.getBlockNumber(),
      getLatestSequence: async () => {
        if (down) throw new Error("RPC unavailable");
        return chain.getLatestSequence();
      },
      publish: (root, sequence) => chain.publish(root, sequence),
    };
    let now = 0;
    const worker = new AnchoringWorker(
      sql,
      outageChain,
      {
        getAccount: async () => {
          throw new Error("unused");
        },
      },
      (alert) => {
        alerts.push(alert);
      },
      {
        timeoutMs: 10,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        failureThreshold: 1,
        resetAfterMs: 10,
        now: () => now,
        random: () => 0,
        sleep: async () => {},
      },
    );
    await expect(worker.runFund(fundId)).rejects.toThrow("RPC unavailable");
    expect(alerts).toHaveLength(1);
    expect(await sql`SELECT id FROM anchors WHERE fund_id = ${fundId}`).toHaveLength(0);
    const health = await createApp().request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
    down = false;
    now = 10;
    await worker.runFund(fundId);
    await worker.runFund(fundId);
    const anchors = await sql<
      { root: string; status: string }[]
    >`SELECT root, status FROM anchors WHERE fund_id = ${fundId}`;
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.status).toBe("confirmed");
    expect(chain.roots.get(1n)).toBe(`0x${anchors[0]?.root}`);
  });
});
