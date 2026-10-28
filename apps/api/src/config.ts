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

export function rateLimits(config: z.infer<typeof rateLimitEnv>) {
  return {
    ip: { capacity: config.RATE_LIMIT_IP_CAPACITY, refillMs: config.RATE_LIMIT_REFILL_MS },
    principal: {
      capacity: config.RATE_LIMIT_PRINCIPAL_CAPACITY,
      refillMs: config.RATE_LIMIT_REFILL_MS,
    },
  };
}
