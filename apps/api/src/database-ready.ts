import type { Sql } from "@yen/db";

export function createDatabaseReady(sql: Sql, options: { readonly cacheMs?: number } = {}) {
  const cacheMs = options.cacheMs ?? 1000;
  let cached: { readonly result: boolean; readonly expiresAt: number } | undefined;
  let inFlight: Promise<boolean> | undefined;

  return (): Promise<boolean> => {
    if (inFlight) return inFlight;
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result);

    let cancel = () => {};
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    const work = Promise.resolve()
      .then(() =>
        sql.begin(async (tx) => {
          const setting = tx`SET LOCAL statement_timeout = '1900ms'`;
          cancel = () => setting.cancel();
          await setting;
          if (expired) throw new Error("Readiness deadline elapsed");
          const query = tx`SELECT 1 FROM waitlist_entries LIMIT 0`;
          cancel = () => query.cancel();
          await query;
        }),
      )
      .then(
        () => true,
        () => false,
      );
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        void Promise.resolve()
          .then(cancel)
          .catch(() => {});
        resolve(false);
      }, 2000);
    });
    const result = Promise.race([work, deadline]);
    inFlight = result;
    void result.then((value) => {
      cached = { result: value, expiresAt: Date.now() + cacheMs };
    });
    void work.then(() => {
      clearTimeout(timer);
      inFlight = undefined;
    });
    return result;
  };
}
