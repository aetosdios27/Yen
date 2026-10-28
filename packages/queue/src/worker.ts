import { createSql, type Sql } from "@yen/db";
import { PgBoss, type Queue, type WorkOptions } from "pg-boss";
import { DEFAULT_QUEUES, DEFAULT_SCHEMA } from "./config.js";
import type { DeadLetterJob, Job, JobHandler, QueuePolicy, WorkerRuntimeOptions } from "./types.js";

interface HandlerRegistration {
  queueName: string;
  handler: JobHandler<unknown>;
  policy: QueuePolicy;
}

interface RawJobRow {
  id: string;
  name: string;
  data: unknown;
  retry_count: number;
  state: string;
  created_on: string | Date;
  output: unknown;
}

export class WorkerRuntime {
  private readonly boss: PgBoss;
  private readonly sql: Sql;
  private readonly options: WorkerRuntimeOptions;
  private readonly registrations = new Map<string, HandlerRegistration>();
  private isStarted = false;
  private stopPromise?: Promise<void>;
  private signalCleanup?: (() => void) | undefined;

  constructor(options: WorkerRuntimeOptions) {
    this.options = options;
    const schema = options.schema ?? DEFAULT_SCHEMA;
    const migrate = options.migrate ?? false;
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema,
      migrate,
      supervise: true,
    });
    this.sql = createSql(options.connectionString);
  }

  public getBoss(): PgBoss {
    return this.boss;
  }

  public registerHandler<T = unknown>(
    queueName: string,
    handler: JobHandler<T>,
    policyOverrides: Partial<QueuePolicy> = {},
  ): this {
    if (this.isStarted) {
      throw new Error(`Cannot register handler for '${queueName}' after worker has started.`);
    }
    const defaultPolicy = this.options.queues?.[queueName] ??
      DEFAULT_QUEUES[queueName] ?? {
        localConcurrency: 5,
        batchSize: 1,
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
        expireInSeconds: 60,
      };

    const policy: QueuePolicy = {
      ...defaultPolicy,
      ...policyOverrides,
    };

    this.registrations.set(queueName, {
      queueName,
      handler: handler as JobHandler<unknown>,
      policy,
    });

    return this;
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;
    try {
      await this.boss.start();

      for (const [queueName, { handler, policy }] of this.registrations.entries()) {
        // Ensure dead-letter queue is created if configured
        if (policy.deadLetter) {
          await this.boss.createQueue(policy.deadLetter);
        }

        const queueOptions: Omit<Queue, "name"> = {};
        if (policy.retryLimit !== undefined) queueOptions.retryLimit = policy.retryLimit;
        if (policy.retryDelay !== undefined) queueOptions.retryDelay = policy.retryDelay;
        if (policy.retryBackoff !== undefined) queueOptions.retryBackoff = policy.retryBackoff;
        if (policy.expireInSeconds !== undefined)
          queueOptions.expireInSeconds = policy.expireInSeconds;
        if (policy.deadLetter !== undefined) queueOptions.deadLetter = policy.deadLetter;

        await this.boss.createQueue(queueName, queueOptions);

        const workOptions: WorkOptions = {
          batchSize: policy.batchSize ?? 1,
          localConcurrency: policy.localConcurrency ?? 5,
          pollingIntervalSeconds: 0.5,
        };

        await this.boss.work(queueName, workOptions, async (jobs) => {
          for (const rawJob of jobs) {
            const job: Job<unknown> = {
              id: rawJob.id,
              name: rawJob.name,
              data: rawJob.data,
              retryCount: rawJob.retryCount,
              expireInSeconds: rawJob.expireInSeconds,
            };
            await handler(job);
          }
        });
      }

      this.setupSignalHandlers();
      this.isStarted = true;
    } catch (err) {
      await this.boss.stop({ graceful: false }).catch(() => {});
      await this.sql.end({ timeout: 2 }).catch(() => {});
      throw err;
    }
  }

  public stop(): Promise<void> {
    this.stopPromise ??= this.shutdown();
    return this.stopPromise;
  }

  private async shutdown(): Promise<void> {
    // The signal listeners stay installed until shutdown finishes. Removing them first lets a
    // repeated SIGTERM (a wrapper plus the process manager) fall back to the default kill and cut
    // the graceful stop short. Repeats are harmless because stop() is idempotent.
    const timeout = this.options.gracefulShutdownTimeoutMs ?? 10000;
    try {
      await this.boss.stop({ graceful: true, timeout });
    } finally {
      await this.sql.end({ timeout: 2 });
      this.isStarted = false;
      if (this.signalCleanup) {
        this.signalCleanup();
        this.signalCleanup = undefined;
      }
    }
  }

  private setupSignalHandlers(): void {
    const onSignal = async (signal: string) => {
      try {
        await this.stop();
      } catch (err) {
        process.stderr.write(`Error during graceful shutdown on ${signal}: ${String(err)}\n`);
      }
    };

    const sigtermHandler = () => void onSignal("SIGTERM");
    const sigintHandler = () => void onSignal("SIGINT");

    process.on("SIGTERM", sigtermHandler);
    process.on("SIGINT", sigintHandler);

    this.signalCleanup = () => {
      process.removeListener("SIGTERM", sigtermHandler);
      process.removeListener("SIGINT", sigintHandler);
    };
  }

  public async getDeadLetterJobs(queueName?: string): Promise<DeadLetterJob[]> {
    const schema = this.options.schema ?? DEFAULT_SCHEMA;

    let rows: RawJobRow[];
    if (queueName) {
      rows = (await this.sql`
        SELECT id, name, data, retry_count, state, created_on, output
        FROM ${this.sql(schema)}.job
        WHERE state = 'failed' AND name = ${queueName}
        ORDER BY created_on DESC
        LIMIT 100
      `) as unknown as RawJobRow[];
    } else {
      rows = (await this.sql`
        SELECT id, name, data, retry_count, state, created_on, output
        FROM ${this.sql(schema)}.job
        WHERE state = 'failed'
        ORDER BY created_on DESC
        LIMIT 100
      `) as unknown as RawJobRow[];
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      data: r.data,
      retryCount: r.retry_count,
      state: r.state,
      createdOn: new Date(r.created_on),
      output: r.output,
    }));
  }
}
