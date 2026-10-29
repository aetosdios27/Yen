import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const rateLimitEnv = z.object({
  WAITLIST_MIN_RESPONSE_MS: z.coerce.number().int().min(0).max(2000).default(75),
  WAITLIST_RATE_LIMIT_CAPACITY: positiveInteger.default(5),
  WAITLIST_RATE_LIMIT_REFILL_MS: positiveInteger.default(3600000),
  WAITLIST_BODY_LIMIT_BYTES: positiveInteger.default(8192),
  PLEDGE_RATE_LIMIT_CAPACITY: positiveInteger.default(10),
  PLEDGE_RATE_LIMIT_REFILL_MS: positiveInteger.default(3600000),
  PLEDGE_BODY_LIMIT_BYTES: positiveInteger.default(4096),
  RATE_LIMIT_MAX_KEYS: z.coerce.number().int().min(1000).max(1000000).default(100000),
  RATE_LIMIT_IP_CAPACITY: positiveInteger.default(120),
  RATE_LIMIT_PRINCIPAL_CAPACITY: positiveInteger.default(60),
  RATE_LIMIT_REFILL_MS: positiveInteger.default(60000),
});

export const poolEnv = z.object({
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  DATABASE_POOL_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(0).max(86400).default(20),
  DATABASE_POOL_ACQUIRE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
});

export const runtimeEnv = z.object({
  CONCURRENCY_LIMIT: z.coerce.number().int().min(1).max(10000).default(100),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(15000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  SERVER_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(20000),
  SERVER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(15000),
  SERVER_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(0).max(60000).default(5000),
  SERVER_MAX_HEADER_SIZE_BYTES: z.coerce.number().int().min(1024).max(1048576).default(16384),
});

export const payeeRulesEnv = z.object({
  PAYEE_FINGERPRINT_SALT: z.string().min(32).optional(),
});

export const clamAvEnv = z.object({
  CLAMAV_HOST: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  CLAMAV_MAX_SIZE_BYTES: z.coerce.number().int().min(1).max(104857600).default(10485760),
});

export function rateLimits(config: z.infer<typeof rateLimitEnv>) {
  return {
    ip: { capacity: config.RATE_LIMIT_IP_CAPACITY, refillMs: config.RATE_LIMIT_REFILL_MS },
    principal: {
      capacity: config.RATE_LIMIT_PRINCIPAL_CAPACITY,
      refillMs: config.RATE_LIMIT_REFILL_MS,
    },
  };
}
