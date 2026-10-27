import { describe, it } from "vitest";

export function describePostgres(name: string, fn: (adminUrl: string) => void): void {
  const rawUrl = process.env.YEN_TEST_DATABASE_URL;
  if (!rawUrl) {
    describe.skip(`${name} (set YEN_TEST_DATABASE_URL to run)`, () => {
      it("skipped because YEN_TEST_DATABASE_URL is not set", () => {});
    });
    return;
  }

  describe(name, () => {
    fn(rawUrl);
  });
}
