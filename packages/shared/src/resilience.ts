import { context, metrics, SpanStatusCode, trace } from "@opentelemetry/api";

let callInstruments:
  | {
      readonly count: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
      readonly duration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
    }
  | undefined;

function getCallInstruments() {
  callInstruments ??= (() => {
    const meter = metrics.getMeter("yen-resilience");
    return {
      count: meter.createCounter("yen.dependency_call.count"),
      duration: meter.createHistogram("yen.dependency_call.duration", { unit: "ms" }),
    };
  })();
  return callInstruments;
}

export type ResilienceOptions = {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  failureThreshold: number;
  resetAfterMs: number;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Low-cardinality span name for a known dependency boundary. */
  spanName?: string;
  /** Money-path label for this dependency, when applicable. */
  metricOperation?: "anchor";
};

/** Bounded outbound call policy with a single half-open probe after cooldown. */
export class ResilientCall {
  private failures = 0;
  private openedAt: number | undefined;
  private probing = false;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ResilienceOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(operation: () => Promise<T>, runOptions: { maxAttempts?: number } = {}): Promise<T> {
    const maxAttempts = runOptions.maxAttempts ?? this.options.maxAttempts;
    if (this.openedAt !== undefined) {
      if (this.now() - this.openedAt < this.options.resetAfterMs || this.probing)
        throw new Error("Circuit breaker is open");
      this.probing = true;
    }
    const callWithTimeout = async <TValue>(call: () => Promise<TValue>): Promise<TValue> => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      let outcome = "ok";
      const span = trace
        .getTracer("yen-resilience")
        .startSpan(this.options.spanName ?? "resilience.call");
      try {
        return await context.with(trace.setSpan(context.active(), span), () =>
          Promise.race([
            call(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Outbound call timed out")),
                this.options.timeoutMs,
              );
            }),
          ]),
        );
      } catch (error) {
        outcome = "error";
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        span.end();
        if (this.options.metricOperation) {
          const attributes = {
            "yen.money.operation": this.options.metricOperation,
            "yen.operation.outcome": outcome,
          };
          const instruments = getCallInstruments();
          instruments.count.add(1, attributes);
          instruments.duration.record(performance.now() - started, attributes);
        }
      }
    };
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const value = await callWithTimeout(operation);
          this.failures = 0;
          this.openedAt = undefined;
          return value;
        } catch (error) {
          if (attempt >= maxAttempts) throw error;
          const cap = Math.min(
            this.options.maxDelayMs,
            this.options.baseDelayMs * 2 ** (attempt - 1),
          );
          await this.sleep(Math.floor(cap * this.random()));
        }
      }
    } catch (error) {
      this.failures++;
      if (this.failures >= this.options.failureThreshold) this.openedAt = this.now();
      throw error;
    } finally {
      this.probing = false;
    }
  }
}
