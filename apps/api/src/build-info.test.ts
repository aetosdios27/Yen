import { afterEach, expect, it, vi } from "vitest";
import { getBuildInfo } from "./build-info.js";

afterEach(() => vi.unstubAllEnvs());

it("reports the verified deployment archive digest at runtime", () => {
  vi.stubEnv("YEN_ARTIFACT_DIGEST", `sha256:${"a".repeat(64)}`);
  expect(getBuildInfo().artifactDigest).toBe(`sha256:${"a".repeat(64)}`);
});

it("rejects malformed deployment digests", () => {
  vi.stubEnv("YEN_ARTIFACT_DIGEST", "not-a-digest");
  expect(() => getBuildInfo()).toThrow();
});
