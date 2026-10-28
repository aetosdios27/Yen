import { parseDatabaseUrl } from "@yen/db";
import * as z from "zod";
import { rateLimitEnv } from "./config.js";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ...rateLimitEnv.shape,
    DATABASE_URL: z.string().optional(),
    OTP_HASH_KEY: z.string().min(32).optional(),
    YEN_ALLOW_MEMORY_STORES: z.enum(["true", "false"]).optional(),
    READINESS_CACHE_MS: z.coerce.number().int().min(0).max(60000).default(1000),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    PORT: z.coerce.number().int().min(1).max(65535),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.OTP_HASH_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_HASH_KEY"],
        message: "Required in production and must contain at least 32 characters",
      });
    }
    if (value.DATABASE_URL === undefined && value.NODE_ENV !== "production") return;
    try {
      parseDatabaseUrl(value.DATABASE_URL, "DATABASE_URL");
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Expected a valid PostgreSQL URL",
      });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `Invalid API environment:\n${parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;
