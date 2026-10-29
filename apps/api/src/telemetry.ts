import type { Context } from "@opentelemetry/api";
import { context, metrics, SpanStatusCode, trace } from "@opentelemetry/api";

let requestInstruments:
  | {
      readonly count: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
      readonly errors: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
      readonly duration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
    }
  | undefined;
let moneyInstruments:
  | {
      readonly count: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
      readonly duration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
    }
  | undefined;

function getRequestInstruments() {
  requestInstruments ??= (() => {
    const meter = metrics.getMeter("yen-api");
    return {
      count: meter.createCounter("http.server.request.count", {
        description: "Completed HTTP requests",
      }),
      errors: meter.createCounter("http.server.request.error.count", {
        description: "HTTP requests completed with server errors",
      }),
      duration: meter.createHistogram("http.server.request.duration", {
        unit: "ms",
        description: "HTTP request duration",
      }),
    };
  })();
  return requestInstruments;
}

function getMoneyInstruments() {
  moneyInstruments ??= (() => {
    const meter = metrics.getMeter("yen-api");
    return {
      count: meter.createCounter("yen.money_operation.count", {
        description: "Money path operations",
      }),
      duration: meter.createHistogram("yen.money_operation.duration", {
        unit: "ms",
        description: "Money path operation duration",
      }),
    };
  })();
  return moneyInstruments;
}

export function withSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const span = trace.getTracer("yen-api").startSpan(name);
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      return await operation();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function startRequestSpan(name: string, parentContext?: Context) {
  return trace.getTracer("yen-api").startSpan(name, {}, parentContext);
}
export function runRequestSpan<T>(
  span: import("@opentelemetry/api").Span,
  operation: () => Promise<T>,
) {
  return context.with(trace.setSpan(context.active(), span), operation);
}
export function recordRequest(method: string, route: string, status: number, durationMs: number) {
  const attributes = {
    "http.request.method": method,
    "http.route": route,
    "http.response.status_code": status,
  };
  const instruments = getRequestInstruments();
  instruments.count.add(1, attributes);
  if (status >= 500) instruments.errors.add(1, attributes);
  instruments.duration.record(durationMs, attributes);
}

export async function withMoneyOperation<T>(
  operation: "approve" | "pay" | "donate" | "reconcile" | "anchor",
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let outcome = "ok";
  try {
    return await withSpan(`money.${operation}`, run);
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    const attributes = { "yen.money.operation": operation, "yen.operation.outcome": outcome };
    const instruments = getMoneyInstruments();
    instruments.count.add(1, attributes);
    instruments.duration.record(performance.now() - started, attributes);
  }
}
