import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

let provider: BasicTracerProvider | undefined;
/** The browser provider exports only spans explicitly created by the API client. */
export function browserTracer(endpoint?: string) {
  if (endpoint && !provider)
    provider = new BasicTracerProvider({
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
        ),
      ],
    });
  return provider?.getTracer("yen-web") ?? trace.getTracer("yen-web");
}

export async function browserApiFetch(
  input: Request,
  endpoint?: string,
  send: typeof fetch = fetch,
): Promise<Response> {
  const span = browserTracer(endpoint).startSpan("browser.api.request");
  const requestId = crypto.randomUUID();
  const request = new Request(input);
  request.headers.set("x-request-id", requestId);
  span.setAttribute("yen.request.id", requestId);
  const parent = span.spanContext();
  if (trace.isSpanContextValid(parent))
    request.headers.set(
      "traceparent",
      `00-${parent.traceId}-${parent.spanId}-${parent.traceFlags & 1 ? "01" : "00"}`,
    );
  try {
    return await send(request);
  } finally {
    span.end();
  }
}
