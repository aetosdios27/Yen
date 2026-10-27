import { describe, expect, it } from "vitest";
import { runVerifyCli } from "./verify-cli.js";

describe("verify-chain CLI unit tests", () => {
  it("prints help and returns 0 when no args or --help is passed", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };

    expect(await runVerifyCli([], {}, out)).toBe(0);
    expect(logs.join("\n")).toContain("Usage: verify-chain");
    expect(logs.join("\n")).toContain("NOT an authenticity proof");

    logs.length = 0;
    expect(await runVerifyCli(["--help"], {}, out)).toBe(0);
    expect(logs.join("\n")).toContain("Usage: verify-chain");

    logs.length = 0;
    expect(await runVerifyCli(["-h"], {}, out)).toBe(0);
    expect(logs.join("\n")).toContain("Usage: verify-chain");
  });

  it("returns 1 on missing or invalid fund ID", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };

    expect(await runVerifyCli(["invalid-uuid"], {}, out)).toBe(1);
    expect(errors.join("\n")).toContain("Invalid fund ID");
  });

  it("returns 1 on unknown option", async () => {
    const errors: string[] = [];
    const out = { log: () => {}, error: (m: string) => errors.push(m) };

    expect(await runVerifyCli(["--unknown"], {}, out)).toBe(1);
    expect(errors.join("\n")).toContain("Unknown option: --unknown");
  });

  it("returns 1 if only one of --head or --count is provided", async () => {
    const errors: string[] = [];
    const out = { log: () => {}, error: (m: string) => errors.push(m) };

    const validFundId = "00000000-0000-0000-0000-000000000000";
    expect(
      await runVerifyCli(
        [validFundId, "--head", "0".repeat(64)],
        { DATABASE_URL: "postgres://localhost" },
        out,
      ),
    ).toBe(1);
    expect(errors.join("\n")).toContain("Both --head and --count must be provided together");

    errors.length = 0;
    expect(
      await runVerifyCli(
        [validFundId, "--count", "10"],
        { DATABASE_URL: "postgres://localhost" },
        out,
      ),
    ).toBe(1);
    expect(errors.join("\n")).toContain("Both --head and --count must be provided together");
  });

  it("returns 1 on invalid count or head format", async () => {
    const errors: string[] = [];
    const out = { log: () => {}, error: (m: string) => errors.push(m) };
    const validFundId = "00000000-0000-0000-0000-000000000000";

    expect(
      await runVerifyCli(
        [validFundId, "--head", "0".repeat(64), "--count", "-1"],
        { DATABASE_URL: "postgres://localhost" },
        out,
      ),
    ).toBe(1);
    expect(errors.join("\n")).toContain("Invalid count");

    errors.length = 0;
    expect(
      await runVerifyCli(
        [validFundId, "--head", "not-a-hash", "--count", "1"],
        { DATABASE_URL: "postgres://localhost" },
        out,
      ),
    ).toBe(1);
    expect(errors.join("\n")).toContain("Invalid head hash");
  });
});
