import { context, metrics, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";

export function observeObjective(id: string, good: boolean) {
  metrics
    .getMeter("yen")
    .createCounter("yen.slo.observations")
    .add(1, { "yen.slo.id": id, "yen.slo.good": good });
}

export async function withTelemetrySpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  return trace.getTracer("yen").startActiveSpan(name, async (span) => {
    try {
      return await run();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

const carrierSchema = z.object({
  traceparent: z
    .string()
    .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    .optional(),
});
export function jobTelemetry(): z.infer<typeof carrierSchema> {
  const span = trace.getSpan(context.active())?.spanContext();
  if (!span || !trace.isSpanContextValid(span)) return {};
  return { traceparent: `00-${span.traceId}-${span.spanId}-${span.traceFlags & 1 ? "01" : "00"}` };
}
export function traceJob<T>(input: unknown, run: () => Promise<T>): Promise<T> {
  const carrier = carrierSchema.safeParse(input);
  const parts = carrier.success ? carrier.data.traceparent?.split("-") : undefined;
  const traceId = parts?.[1];
  const spanId = parts?.[2];
  const parent =
    traceId && spanId && !/^0+$/.test(traceId) && !/^0+$/.test(spanId)
      ? trace.setSpanContext(ROOT_CONTEXT, {
          traceId,
          spanId,
          traceFlags: parts?.[3] === "01" ? 1 : 0,
          isRemote: true,
        })
      : ROOT_CONTEXT;
  return context.with(parent, () => withTelemetrySpan("queue.job", run));
}

export async function measuredObjective<T>(
  id: string,
  run: () => Promise<T>,
  isServiceFailure: (error: unknown) => boolean = () => true,
): Promise<T> {
  let good = false;
  try {
    const result = await run();
    good = true;
    return result;
  } catch (error) {
    good = !isServiceFailure(error);
    throw error;
  } finally {
    observeObjective(id, good);
  }
}
export function recordSaturation(
  name: "database.client_connections" | "queue.depth" | "event_loop.lag" | "append_lock.wait",
  value: number,
) {
  metrics
    .getMeter("yen")
    .createHistogram(`yen.${name}`, {
      unit: name.endsWith("lag") || name.endsWith("wait") ? "ms" : "{item}",
    })
    .record(value);
}

export async function probePublicPage(url: URL, fetchPage: typeof fetch = fetch): Promise<boolean> {
  let good = false;
  try {
    const response = await fetchPage(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    good = response.ok;
    await response.body?.cancel();
  } catch {
    good = false;
  } finally {
    observeObjective("public_page_availability", good);
  }
  return good;
}

export function recordSamplerFailure(measurement: string): void {
  metrics.getMeter("yen").createCounter("yen.telemetry.sampler_failures").add(1, { measurement });
}
