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
      try {
        return await Promise.race([
          call(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Outbound call timed out")),
              this.options.timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
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
