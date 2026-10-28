export type QueueName = "notifications" | "reconciliation" | "blockchain-anchoring" | (string & {});

export interface QueuePolicy {
  localConcurrency?: number;
  batchSize?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  deadLetter?: string;
}

export interface EnqueueOptions {
  id?: string;
  priority?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  singletonKey?: string;
  singletonSeconds?: number;
  startAfter?: number | string | Date;
  deadLetter?: string;
}

export interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  retryCount: number;
  expireInSeconds: number;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export interface WorkerRuntimeOptions {
  connectionString: string;
  schema?: string;
  migrate?: boolean;
  queues?: Record<string, QueuePolicy>;
  gracefulShutdownTimeoutMs?: number;
}

export interface DeadLetterJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  retryCount: number;
  state: string;
  createdOn: Date;
  failedOn?: Date;
  output?: unknown;
}
