import { randomInt } from "node:crypto";
import { createSql, migrate, uuidv7 } from "@yen/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../../packages/db/src/test/database.js";
import { MemoryPinNotificationService } from "./notifications.js";
import { PinService } from "./service.js";
import { MemoryActionTokenStore, PostgresPinStore } from "./store.js";

const pin = "482915";
const wrongPin = "937104";
const actionHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const pinSecret = "postgres_pin_hmac_secret_longer_than_32_bytes";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing item at index ${index}`);
  return item;
}

databaseSuite("Postgres PIN lockout concurrency", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;

  beforeAll(async () => {
    await migrate(sql);
    secondSql = createSql(url, { max: 60 });
  });

  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
  });

  async function user() {
    const userId = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'PIN Test')`;
    const notifications = new MemoryPinNotificationService();
    const stores = [new PostgresPinStore(sql), new PostgresPinStore(secondSql)];
    const services = stores.map(
      (pinStore) =>
        new PinService({
          pinStore,
          actionTokenStore: new MemoryActionTokenStore(),
          notificationService: notifications,
          pinSecret,
        }),
    );
    await services[0]?.setupPin(userId, pin);
    return { userId, notifications, services, stores };
  }

  function attempt(service: PinService, userId: string, value: string) {
    return service.verifyPin(userId, value, actionHash);
  }

  it("counts concurrent wrong guesses exactly through the fifth and rejects correct guesses while locked", async () => {
    const { userId, services, stores } = await user();
    const requests = Array.from({ length: 50 }, (_, index) =>
      attempt(at(services, index % services.length), userId, wrongPin).then(
        () => "accepted",
        (error: unknown) => error,
      ),
    );
    const results = await Promise.all(requests);
    const record = await stores[0]?.get(userId);
    expect(results.filter((result) => result === "accepted")).toHaveLength(0);
    expect(record?.failedAttempts).toBe(5);
    expect(record?.failedAttempts).toBeLessThanOrEqual(5);
    expect(record?.lockedUntil).not.toBeNull();
    await expect(attempt(at(services, 1), userId, pin)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("serializes mixed correct and wrong guesses without clearing later failures", async () => {
    const { userId, services, stores } = await user();
    const guesses = [
      ...Array.from({ length: 50 }, (_, index) =>
        attempt(at(services, index % 2), userId, wrongPin),
      ),
      ...Array.from({ length: 5 }, () => attempt(at(services, 1), userId, pin)),
    ];
    await Promise.all(
      guesses.map((request) =>
        request.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    // A correct PIN that wins the row lock legitimately resets the counter, so how many
    // wrong guesses count after the last reset depends on scheduling. Assert only what
    // must hold for every ordering: the budget is never exceeded, and the lock state
    // always agrees with the counter.
    const record = await stores[0]?.get(userId);
    const failed = record?.failedAttempts ?? Number.NaN;
    expect(failed).toBeGreaterThanOrEqual(0);
    expect(failed).toBeLessThanOrEqual(5);
    expect(record?.lockedUntil !== null).toBe(failed === 5);
    if (failed === 5) {
      await expect(attempt(at(services, 0), userId, pin)).rejects.toMatchObject({
        code: "rate_limited",
      });
    }
  });

  it("locks at the tenth rolling-window failure and sends only one notification", async () => {
    let now = Date.now();
    const { userId, notifications, stores } = await user();
    // Replace service clocks with a stable test clock while retaining DB-backed stores.
    const clocked = stores.map(
      (pinStore) =>
        new PinService({
          pinStore,
          actionTokenStore: new MemoryActionTokenStore(),
          notificationService: notifications,
          pinSecret,
          clock: () => now,
        }),
    );
    // Build nine genuine failures over two consecutive-attempt windows.
    for (let index = 0; index < 5; index += 1)
      await attempt(at(clocked, index % 2), userId, wrongPin).catch(() => undefined);
    now += 31 * 60 * 1000;
    await stores[0]?.update(userId, { lockedUntil: null, failedAttempts: 0 });
    for (let index = 0; index < 4; index += 1)
      await attempt(at(clocked, index % 2), userId, wrongPin).catch(() => undefined);
    const concurrent = Array.from({ length: 50 }, (_, index) =>
      attempt(at(clocked, index % 2), userId, wrongPin),
    );
    await Promise.all(
      concurrent.map((request) =>
        request.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    const record = await stores[0]?.get(userId);
    expect(record?.totalFailed24h).toBe(10);
    expect(record?.status).toBe("locked_out");
    expect(notifications.getEvents().filter((event) => event.kind === "pin_lockout")).toHaveLength(
      1,
    );
    await expect(attempt(at(clocked, 0), userId, pin)).rejects.toMatchObject({ code: "forbidden" });
  });
});
