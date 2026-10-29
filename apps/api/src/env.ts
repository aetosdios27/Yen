import { isAbsolute } from "node:path";
import { parseDatabaseUrl } from "@yen/db";
import { parseExotelSmsTemplates, parseWhatsAppTemplates } from "@yen/notifications";
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
    WEBAUTHN_RP_ID: z.string().min(1).optional(),
    WEBAUTHN_ORIGIN: z.url().optional(),
    WEBAUTHN_RP_NAME: z.string().min(1).max(80).default("Yen"),
    DELIVERY_PROVIDER: z.enum(["stub", "external"]).default("stub"),
    WHATSAPP_API_BASE_URL: z.string().url().optional(),
    WHATSAPP_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    WHATSAPP_TEMPLATES_JSON: z.string().optional(),
    EXOTEL_SMS_ENDPOINT: z.string().url().optional(),
    EXOTEL_SMS_STATUS_CALLBACK_URL: z.string().url().optional(),
    EXOTEL_API_KEY: z.string().min(1).optional(),
    EXOTEL_API_TOKEN: z.string().min(1).optional(),
    EXOTEL_SENDER_ID: z.string().min(1).optional(),
    EXOTEL_DLT_ENTITY_ID: z.string().min(1).optional(),
    EXOTEL_SMS_TEMPLATES_JSON: z.string().optional(),
    META_APP_SECRET: z.string().min(1).optional(),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
    EXOTEL_RELAY_WEBHOOK_SECRET: z.string().min(1).optional(),
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
    if (value.NODE_ENV === "production" && value.WEBAUTHN_RP_ID === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["WEBAUTHN_RP_ID"],
        message: "Required in production for device credential verification",
      });
    }
    if (value.NODE_ENV === "production" && value.WEBAUTHN_ORIGIN === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["WEBAUTHN_ORIGIN"],
        message: "Required in production for device credential verification",
      });
    if (value.NODE_ENV === "production") {
      const required: Array<keyof typeof value> = [
        "DELIVERY_PROVIDER",
        "WHATSAPP_API_BASE_URL",
        "WHATSAPP_API_VERSION",
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_TEMPLATES_JSON",
        "EXOTEL_SMS_ENDPOINT",
        "EXOTEL_SMS_STATUS_CALLBACK_URL",
        "EXOTEL_API_KEY",
        "EXOTEL_API_TOKEN",
        "EXOTEL_SENDER_ID",
        "EXOTEL_DLT_ENTITY_ID",
        "EXOTEL_SMS_TEMPLATES_JSON",
        "META_APP_SECRET",
        "META_WEBHOOK_VERIFY_TOKEN",
        "EXOTEL_RELAY_WEBHOOK_SECRET",
      ];
      for (const key of required) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required in production delivery configuration",
          });
      }
      if (value.DELIVERY_PROVIDER !== "external") {
        ctx.addIssue({
          code: "custom",
          path: ["DELIVERY_PROVIDER"],
          message: "Production requires explicitly configured external delivery providers",
        });
      }
      if (value.WHATSAPP_TEMPLATES_JSON) {
        try {
          parseWhatsAppTemplates(value.WHATSAPP_TEMPLATES_JSON);
        } catch {
          ctx.addIssue({
            code: "custom",
            path: ["WHATSAPP_TEMPLATES_JSON"],
            message: "Expected configured provider template names, languages, and parameter lists",
          });
        }
      }
      if (value.EXOTEL_SMS_TEMPLATES_JSON) {
        try {
          parseExotelSmsTemplates(value.EXOTEL_SMS_TEMPLATES_JSON);
        } catch {
          ctx.addIssue({
            code: "custom",
            path: ["EXOTEL_SMS_TEMPLATES_JSON"],
            message: "Expected configured Exotel DLT template IDs and OTP message templates",
          });
        }
      }
      for (const [name, address] of [
        ["WHATSAPP_API_BASE_URL", value.WHATSAPP_API_BASE_URL],
        ["EXOTEL_SMS_ENDPOINT", value.EXOTEL_SMS_ENDPOINT],
        ["EXOTEL_SMS_STATUS_CALLBACK_URL", value.EXOTEL_SMS_STATUS_CALLBACK_URL],
      ] as const) {
        if (address && new URL(address).protocol !== "https:") {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: "HTTPS is required for production delivery providers",
          });
        }
      }
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
