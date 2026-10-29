import {
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResponse,
  ResilientCall,
} from "@yen/shared";
import * as z from "zod";

class SmsGatewayServerFailure extends Error {}

const localizedTextSchema = z.object({ en: z.string().min(1), hi: z.string().min(1) });
const exotelSmsTemplateSchema = z.object({
  templateId: z.union([z.string().min(1), localizedTextSchema]),
  otpBody: localizedTextSchema.optional(),
});

export const exotelSmsTemplatesSchema = z
  .record(z.string().min(1), exotelSmsTemplateSchema)
  .superRefine((templates, context) => {
    for (const required of [
      "otp",
      "approval_needed",
      "approved_rejected",
      "donation_received",
      "objection_raised",
      "weekly_summary",
    ]) {
      if (!(required in templates)) {
        context.addIssue({
          code: "custom",
          path: [required],
          message: "Required Exotel DLT template is missing",
        });
      }
    }
    const otpBody = templates.otp?.otpBody;
    if (!otpBody?.en.includes("{{code}}") || !otpBody?.hi.includes("{{code}}")) {
      context.addIssue({
        code: "custom",
        path: ["otp", "otpBody"],
        message: "Both OTP SMS bodies must contain the code placeholder",
      });
    }
  });

export type ExotelSmsTemplates = z.infer<typeof exotelSmsTemplatesSchema>;

export function parseExotelSmsTemplates(input: string): ExotelSmsTemplates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Exotel SMS template configuration is invalid");
  }
  const result = exotelSmsTemplatesSchema.safeParse(parsed);
  if (!result.success) throw new Error("Exotel SMS template configuration is invalid");
  return result.data;
}

export interface ExotelSmsConfig {
  endpoint: string;
  apiKey: string;
  apiToken: string;
  senderId: string;
  entityId: string;
  statusCallbackUrl: string;
  templates: ExotelSmsTemplates;
  timeoutMs?: number;
}

export interface SmsGatewayRequest {
  to: string;
  message: string;
  idempotencyKey: string;
  templateId: string;
}

/** Generic HTTP gateway used by the channel-neutral SMS provider. */
export interface SmsHttpGateway {
  send(request: SmsGatewayRequest): Promise<{ messageId: string }>;
}

/** Concrete Exotel form-encoded HTTP gateway. */
export class ExotelSmsHttpGateway implements SmsHttpGateway {
  private readonly resilient = new ResilientCall({
    timeoutMs: 10_000,
    maxAttempts: 1,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    failureThreshold: 5,
    resetAfterMs: 60_000,
  });

  constructor(
    private readonly config: ExotelSmsConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const endpoint = new URL(config.endpoint);
    const callback = new URL(config.statusCallbackUrl);
    const localHttpHosts = ["127.0.0.1", "localhost", "::1"];
    const localHttp = endpoint.protocol === "http:" && localHttpHosts.includes(endpoint.hostname);
    const localCallbackHttp =
      callback.protocol === "http:" && localHttpHosts.includes(callback.hostname);
    if (endpoint.protocol !== "https:" && !localHttp) {
      throw new Error("SMS gateway endpoint must use HTTPS");
    }
    if (callback.protocol !== "https:" && !localCallbackHttp) {
      throw new Error("SMS status callback must use HTTPS");
    }
    if (!config.apiKey || !config.apiToken || !config.senderId || !config.entityId) {
      throw new Error("SMS gateway configuration is incomplete");
    }
  }

  async send(request: SmsGatewayRequest): Promise<{ messageId: string }> {
    const body = new URLSearchParams({
      From: this.config.senderId,
      To: request.to,
      Body: request.message,
      DltEntityId: this.config.entityId,
      DltTemplateId: request.templateId,
      StatusCallback: this.config.statusCallbackUrl,
      CustomField: request.idempotencyKey,
    });
    let response: Response;
    try {
      response = await this.resilient.run(
        async () => {
          const result = await this.fetcher(this.config.endpoint, {
            method: "POST",
            headers: {
              authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiToken}`).toString("base64")}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body,
            signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
          });
          if (result.status >= 500) throw new SmsGatewayServerFailure();
          return result;
        },
        // Exotel does not document request idempotency, so never retry an ambiguous send.
        { maxAttempts: 1 },
      );
    } catch (error) {
      if (error instanceof SmsGatewayServerFailure) throw new Error("SMS gateway rejected request");
      throw new Error("SMS gateway request failed");
    }
    if (!response.ok) throw new Error("SMS gateway rejected request");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("SMS gateway returned a malformed response");
    }
    const parsed = z
      .object({ SMSMessage: z.object({ Sid: z.string().min(1) }) })
      .safeParse(payload);
    if (!parsed.success) throw new Error("SMS gateway returned a malformed response");
    return { messageId: parsed.data.SMSMessage.Sid };
  }
}

export class ExotelSmsProvider implements DeliveryProvider {
  private readonly gateway: SmsHttpGateway;

  constructor(
    private readonly config: ExotelSmsConfig,
    fetcher: typeof fetch = fetch,
    gateway?: SmsHttpGateway,
  ) {
    const templates = exotelSmsTemplatesSchema.safeParse(config.templates);
    if (!templates.success) throw new Error("Exotel SMS template configuration is invalid");
    this.gateway = gateway ?? new ExotelSmsHttpGateway(config, fetcher);
  }

  async send(request: DeliveryRequest): Promise<DeliveryResponse> {
    if (request.channel !== "sms") throw new Error("Wrong channel for SMS provider");
    const template = this.config.templates[request.template];
    if (!template) throw new Error("SMS template is not configured");
    const locale = request.params.locale === "hi" ? "hi" : "en";
    const message =
      request.params.body ?? renderOtpBody(template.otpBody?.[locale], request.params);
    if (!message) throw new Error("SMS message body is missing");
    const templateId =
      typeof template.templateId === "string" ? template.templateId : template.templateId[locale];
    const result = await this.gateway.send({
      to: request.to,
      message,
      idempotencyKey: request.idempotencyKey,
      templateId,
    });
    return { messageId: result.messageId, status: "accepted", idempotencyGuaranteed: false };
  }
}

function renderOtpBody(
  template: string | undefined,
  params: Readonly<Record<string, string>>,
): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_placeholder, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error("SMS template parameter is missing");
    return value;
  });
}
