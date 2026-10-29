import { isAbsolute } from "node:path";
import { parseDatabaseUrl } from "@yen/db";
import * as z from "zod";
import { clamAvEnv, payeeRulesEnv, poolEnv, rateLimitEnv, runtimeEnv } from "./config.js";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ...rateLimitEnv.shape,
    ...poolEnv.shape,
    ...runtimeEnv.shape,
    ...clamAvEnv.shape,
    ...payeeRulesEnv.shape,
    DATABASE_URL: z.string().optional(),
    EVIDENCE_STORAGE_DIR: z.string().min(1).optional(),
    OTP_HASH_KEY: z.string().min(32).optional(),
    PARTNER_WEBHOOK_SECRET: z.string().min(32).optional(),
    YEN_ALLOW_MEMORY_STORES: z.enum(["true", "false"]).optional(),
    READINESS_CACHE_MS: z.coerce.number().int().min(0).max(60000).default(1000),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    TRUSTED_PROXY_HEADER: z.enum(["x-forwarded-for", "forwarded"]).default("x-forwarded-for"),
    CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
    PORT: z.coerce.number().int().min(1).max(65535),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.CLAMAV_HOST === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["CLAMAV_HOST"],
        message: "Required in production; evidence scanning must be configured",
      });
    }
    if (value.NODE_ENV === "production" && value.OTP_HASH_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_HASH_KEY"],
        message: "Required in production and must contain at least 32 characters",
      });
    }
    if (value.NODE_ENV === "production" && value.PAYEE_FINGERPRINT_SALT === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYEE_FINGERPRINT_SALT"],
        message: "Required in production and must contain at least 32 characters",
      });
    }
    if (value.NODE_ENV === "production" && value.EVIDENCE_STORAGE_DIR === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["EVIDENCE_STORAGE_DIR"],
        message: "Required in production for durable evidence bytes",
      });
    } else if (
      value.NODE_ENV === "production" &&
      value.EVIDENCE_STORAGE_DIR !== undefined &&
      !isAbsolute(value.EVIDENCE_STORAGE_DIR)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["EVIDENCE_STORAGE_DIR"],
        message: "Must be an absolute path in production",
      });
    }
    if (value.SERVER_HEADERS_TIMEOUT_MS <= value.SERVER_KEEP_ALIVE_TIMEOUT_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["SERVER_HEADERS_TIMEOUT_MS"],
        message: "SERVER_HEADERS_TIMEOUT_MS must be greater than SERVER_KEEP_ALIVE_TIMEOUT_MS",
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
