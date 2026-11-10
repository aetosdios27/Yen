import { expect, it } from "vitest";
import { browserApiFetch } from "./browser-tracing.js";

it("creates a valid W3C parent and request id without a browser SDK", async () => {
  await browserApiFetch(new Request("https://example.test"), async (request) => {
    const headers = new Request(request).headers;
    expect(headers.get("traceparent")).toMatch(
      /^00-(?!0{32})[a-f0-9]{32}-(?!0{16})[a-f0-9]{16}-01$/,
    );
    expect(headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    return new Response();
  });
});

it("keeps browser tracing below a 1500-byte minified JS budget", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/browser-tracing.ts"],
    bundle: true,
    platform: "browser",
    minify: true,
    write: false,
  });
  expect(result.outputFiles[0]?.contents.byteLength).toBeLessThan(1500);
});
