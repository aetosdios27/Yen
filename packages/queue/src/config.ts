import type { QueuePolicy } from "./types.js";

export const DEFAULT_SCHEMA = "pgboss";

export const DEFAULT_QUEUES: Record<string, QueuePolicy> = {
  notifications: {
    teamConcurrency: 10,
    batchSize: 5,
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 30,
    deadLetter: "notifications-dead-letter",
  },
  reconciliation: {
    teamConcurrency: 2,
    batchSize: 1,
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: "reconciliation-dead-letter",
  },
  "blockchain-anchoring": {
    teamConcurrency: 1,
    batchSize: 1,
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: "blockchain-anchoring-dead-letter",
  },
};
