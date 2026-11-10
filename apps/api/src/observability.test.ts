import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { expect, it } from "vitest";
import { createApp } from "./app.js";
import { serializeRequestLog } from "./logging.js";
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
  const logs: string[] = [];
  const app = createApp({ logger: { log: (entry) => logs.push(serializeRequestLog(entry)) } });
  app.get("/trace-test/:expenseId", (c) => c.json({ ok: true }));
  const response = await app.request(
    "/trace-test/secret-personal-id?phone=%2B919876543210&email=private%40example.com&name=Private%20Person&vpa=private%40yenbank",
    {
      headers: {
        authorization: "Bearer secret-token",
        tracestate: "yen=private@example.com",
        traceparent: "00-11111111111111111111111111111111-1111111111111111-01",
      },
    },
  );
  expect(response.status).toBe(200);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.name).toBe("GET /trace-test/:expenseId");
  const exported = JSON.stringify(
    spans.map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
      traceState: span.spanContext().traceState?.serialize(),
    })),
  );
  expect(logs.join("\n") + exported).not.toMatch(
    /secret-personal-id|919876543210|secret-token|private@example.com|Private Person|private@yenbank/i,
  );
  expect(exported).toContain("/trace-test/:expenseId");
  expect(exported).not.toMatch(
    /secret-personal-id|919876543210|secret-token|userId|phone|amount|upi/i,
  );
  await provider.shutdown();
});
