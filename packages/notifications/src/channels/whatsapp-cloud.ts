import {
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResponse,
  ResilientCall,
} from "@yen/shared";
import * as z from "zod";

class WhatsAppServerFailure extends Error {}

const templateConfigSchema = z.object({
  name: z.string().min(1),
  language: z.union([
    z.string().min(1),
    z.object({ en: z.string().min(1), hi: z.string().min(1) }),
  ]),
  parameters: z.array(z.string().min(1)),
});

export const whatsappTemplatesSchema = z
  .record(z.string().min(1), templateConfigSchema)
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
          message: "Required WhatsApp template is missing",
        });
      }
    }
    if (templates.otp && !templates.otp.parameters.includes("code")) {
      context.addIssue({
        code: "custom",
        path: ["otp", "parameters"],
        message: "The OTP template must include the code parameter",
      });
    }
  });

export type WhatsAppTemplates = z.infer<typeof whatsappTemplatesSchema>;

export function parseWhatsAppTemplates(input: string): WhatsAppTemplates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("WhatsApp template configuration is invalid");
  }
  const result = whatsappTemplatesSchema.safeParse(parsed);
  if (!result.success) throw new Error("WhatsApp template configuration is invalid");
  return result.data;
}

export interface WhatsAppCloudConfig {
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  templates: WhatsAppTemplates;
  timeoutMs?: number;
}

/**
 * Meta Postman exposes the message route; its request body panel did not render.
 * The archived Meta SDK documents template components. Exact raw payload compatibility
 * with the active Graph API docs remains unverified because developers.facebook.com
 * was inaccessible. See docs/REFERENCES.md for the evidence boundary.
 */
export class WhatsAppCloudProvider implements DeliveryProvider {
  private readonly resilient = new ResilientCall({
    timeoutMs: 10_000,
    maxAttempts: 1,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    failureThreshold: 5,
    resetAfterMs: 60_000,
  });

  constructor(
    private readonly config: WhatsAppCloudConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const base = new URL(config.apiBaseUrl);
    const localHttp =
      base.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(base.hostname);
    if (base.protocol !== "https:" && !localHttp) {
      throw new Error("WhatsApp API base URL must use HTTPS");
    }
    if (!/^v\d+\.\d+$/.test(config.apiVersion) || !config.phoneNumberId || !config.accessToken) {
      throw new Error("WhatsApp provider configuration is invalid");
    }
    const templates = whatsappTemplatesSchema.safeParse(config.templates);
    if (!templates.success) throw new Error("WhatsApp template configuration is invalid");
  }

  async send(request: DeliveryRequest): Promise<DeliveryResponse> {
    if (request.channel !== "whatsapp") throw new Error("Wrong channel for WhatsApp provider");
    const template = this.config.templates[request.template];
    if (!template) throw new Error("WhatsApp template is not configured");
    const parameters = template.parameters.map((key) => {
      const value = request.params[key];
      if (value === undefined) throw new Error("WhatsApp template parameter is missing");
      return { type: "text", text: value };
    });
    const language =
      typeof template.language === "string"
        ? template.language
        : template.language[request.params.locale === "hi" ? "hi" : "en"];
    const url = new URL(
      `${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`,
      this.config.apiBaseUrl.endsWith("/") ? this.config.apiBaseUrl : `${this.config.apiBaseUrl}/`,
    );
    let response: Response;
    try {
      response = await this.resilient.run(
        async () => {
          const result = await this.fetcher(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: request.to.replace(/^\+/, ""),
              type: "template",
              template: {
                name: template.name,
                language: { code: language },
                components: [{ type: "body", parameters }],
              },
            }),
            signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
          });
          if (result.status >= 500) throw new WhatsAppServerFailure();
          return result;
        },
        // Meta's public contract does not document request idempotency. Ambiguous sends are never retried.
        { maxAttempts: 1 },
      );
    } catch (error) {
      if (error instanceof WhatsAppServerFailure)
        throw new Error("WhatsApp provider rejected the request");
      throw new Error("WhatsApp provider request failed");
    }
    if (!response.ok) throw new Error("WhatsApp provider rejected the request");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("WhatsApp provider returned a malformed response");
    }
    const result = z
      .object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) })
      .safeParse(payload);
    if (!result.success) throw new Error("WhatsApp provider returned a malformed response");
    const id = result.data.messages[0]?.id;
    if (!id) throw new Error("WhatsApp provider returned a malformed response");
    return { messageId: id, status: "accepted", idempotencyGuaranteed: false };
  }
}
