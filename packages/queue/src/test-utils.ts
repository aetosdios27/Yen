import { parseDatabaseUrl } from "@yen/db";
import { describe, it } from "vitest";

export function describePostgres(name: string, fn: (adminUrl: string) => void): void {
  const rawUrl = process.env.YEN_TEST_DATABASE_URL;
  if (rawUrl === undefined) {
    describe.skip(`${name} (set YEN_TEST_DATABASE_URL to run)`, () => {
      it("skipped because YEN_TEST_DATABASE_URL is not set", () => {});
    });
    return;
  }

  const adminUrl = parseDatabaseUrl(rawUrl, "YEN_TEST_DATABASE_URL");
  describe(name, () => {
    fn(adminUrl);
  });
}

/** Polls `check` until it returns a defined value. Fails when the deadline passes first. */
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 10000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}
