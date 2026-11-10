import * as z from "zod";
import { parseExotelSmsTemplates } from "./channels/exotel-sms.js";
import { parseWhatsAppTemplates } from "./channels/whatsapp-cloud.js";

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:");
const sandboxEnvironment = z.object({
  YEN_SANDBOX_PHONE: z.string().regex(/^\+[1-9]\d{7,14}$/),
  WHATSAPP_API_BASE_URL: httpsUrl,
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_TEMPLATES_JSON: z.string().min(1),
  EXOTEL_SMS_ENDPOINT: httpsUrl,
  EXOTEL_SMS_STATUS_CALLBACK_URL: httpsUrl,
  EXOTEL_API_KEY: z.string().min(1),
  EXOTEL_API_TOKEN: z.string().min(1),
  EXOTEL_SENDER_ID: z.string().min(1),
  EXOTEL_DLT_ENTITY_ID: z.string().min(1),
  EXOTEL_SMS_TEMPLATES_JSON: z.string().min(1),
});

export function loadSandboxConfig(environment: NodeJS.ProcessEnv) {
  if (environment.CI !== undefined || environment.YEN_DELIVERY_SANDBOX !== "1") return null;
  if (Object.keys(sandboxEnvironment.shape).some((key) => !environment[key])) return null;
  try {
    const env = sandboxEnvironment.parse(environment);
    return {
      phone: env.YEN_SANDBOX_PHONE,
      whatsapp: {
        apiBaseUrl: env.WHATSAPP_API_BASE_URL,
        apiVersion: env.WHATSAPP_API_VERSION,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        templates: parseWhatsAppTemplates(env.WHATSAPP_TEMPLATES_JSON),
      },
      sms: {
        endpoint: env.EXOTEL_SMS_ENDPOINT,
        apiKey: env.EXOTEL_API_KEY,
        apiToken: env.EXOTEL_API_TOKEN,
        senderId: env.EXOTEL_SENDER_ID,
        entityId: env.EXOTEL_DLT_ENTITY_ID,
        statusCallbackUrl: env.EXOTEL_SMS_STATUS_CALLBACK_URL,
        templates: parseExotelSmsTemplates(env.EXOTEL_SMS_TEMPLATES_JSON),
      },
    };
  } catch {
    throw new Error("Invalid delivery sandbox configuration");
  }
}
