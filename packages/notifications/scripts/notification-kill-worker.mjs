import { createSql } from "@yen/db";
import { paise } from "@yen/shared";
import { NotificationsWorker, PostgresNotificationStore } from "../dist/index.js";

const sql = createSql(process.env.YEN_TEST_DATABASE_URL);
const point = process.env.YEN_CHAOS_KILL_POINT;
const store = new PostgresNotificationStore(sql);
const park = () => new Promise(() => {});
const signal = () => process.stdout.write(`CHAOS_KILL_POINT:${point}\n`);
const wrappedStore = new Proxy(store, {
  get(target, property) {
    if (property === "claimBatch")
      return async (...args) => {
        const rows = await target.claimBatch(...args);
        if (point === "claimed" && rows.length > 0) {
          signal();
          await park();
        }
        return rows;
      };
    if (property === "markSubmitted")
      return async (...args) => {
        const result = await target.markSubmitted(...args);
        if (point === "status-recorded" && result) {
          signal();
          await park();
        }
        return result;
      };
    if (property === "prepareSend")
      return async (...args) => {
        const result = await target.prepareSend(...args);
        if (point === "send-started" && result === "prepared") {
          signal();
          await park();
        }
        return result;
      };
    const value = target[property];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const provider = {
  channel: "whatsapp",
  costPerMessagePaise: paise(0),
  async send(input) {
    await sql`INSERT INTO yen61_provider_calls (idempotency_key) VALUES (${input.idempotencyKey})`;
    await sql`
      INSERT INTO yen61_provider_effects (idempotency_key)
      VALUES (${input.idempotencyKey}) ON CONFLICT (idempotency_key) DO NOTHING
    `;
    if (point === "sent-to-provider") {
      signal();
      await park();
    }
    return {
      success: true,
      channel: "whatsapp",
      cost_paise: paise(0),
      provider_message_id: input.idempotencyKey,
      provider_status: "accepted",
    };
  },
};
const worker = new NotificationsWorker({
  store: wrappedStore,
  whatsappProvider: provider,
  smsProvider: provider,
  leaseDurationMs: 250,
});

try {
  await worker.processNextBatch();
  process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 });
}
