import { describe, expect, it } from "vitest";
import { buildSentryEnvelope, parseSentryDsn, sentryEnvelopeHeaders } from "./sentry.js";

describe("parseSentryDsn", () => {
  it("parses https DSNs into the envelope endpoint", () => {
    expect(parseSentryDsn("https://key@sentry.example/1")).toEqual({
      envelopeUrl: "https://sentry.example/api/1/envelope/",
      publicKey: "key",
    });
  });

  it("parses http DSNs for self-hosted Sentry", () => {
    expect(parseSentryDsn("http://key@sentry.internal/7")).toEqual({
      envelopeUrl: "http://sentry.internal/api/7/envelope/",
      publicKey: "key",
    });
  });

  it("rejects DSNs without a numeric project id", () => {
    expect(parseSentryDsn("https://key@sentry.example/proj")).toBeNull();
    expect(parseSentryDsn("https://sentry.example/1")).toBeNull();
    expect(parseSentryDsn("ftp://key@sentry.example/1")).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
  });
});

describe("sentry envelope encoding", () => {
  it("sets envelope auth headers with the public key", () => {
    expect(sentryEnvelopeHeaders("key", "yen.api/1.0.0")).toEqual({
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": "Sentry sentry_version=7, sentry_client=yen.api/1.0.0, sentry_key=key",
    });
  });

  it("serializes a three line envelope with header, item and event", () => {
    const envelope = buildSentryEnvelope("d6e2c2d4-9f0e-4c1a-8f1d-2b3c4d5e6f70", {
      release: "sha",
    });
    const lines = envelope.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event_id: "d6e2c2d4-9f0e-4c1a-8f1d-2b3c4d5e6f70",
      sdk: { name: "yen.api", version: "1.0.0" },
    });
    expect(JSON.parse(lines[1] ?? "{}")).toEqual({ type: "event" });
    expect(JSON.parse(lines[2] ?? "{}")).toEqual({ release: "sha" });
  });

  it("accepts a custom sdk name and sent_at timestamp", () => {
    const envelope = buildSentryEnvelope(
      "event",
      {},
      "2026-11-11T00:00:00.000Z",
      "yen.web",
      "2.0.0",
    );
    expect(JSON.parse(envelope.split("\n")[0] ?? "{}")).toMatchObject({
      sent_at: "2026-11-11T00:00:00.000Z",
      sdk: { name: "yen.web", version: "2.0.0" },
    });
  });
});
