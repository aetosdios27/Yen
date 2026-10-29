import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { startRequestSpan } from "./telemetry.js";

it("exports templated request spans without raw path or request data attributes", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.disable();
  provider.register();
  const probe = startRequestSpan("provider.probe");
  expect(probe.isRecording()).toBe(true);
  probe.end();
  await provider.forceFlush();
  exporter.reset();
  const app = createApp();
  app.get("/trace-test/:expenseId", (c) => c.json({ ok: true }));
  const response = await app.request("/trace-test/secret-personal-id?phone=%2B919876543210", {
    headers: { authorization: "Bearer secret-token" },
  });
  expect(response.status).toBe(200);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.name).toBe("GET /trace-test/:expenseId");
  const exported = JSON.stringify(spans.map((span) => span.attributes));
  expect(exported).toContain("/trace-test/:expenseId");
  expect(exported).not.toMatch(
    /secret-personal-id|919876543210|secret-token|userId|phone|name|amount|upi/i,
  );
  await provider.shutdown();
});
