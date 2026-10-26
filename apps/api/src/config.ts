import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const rateLimitEnv = z.object({
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
