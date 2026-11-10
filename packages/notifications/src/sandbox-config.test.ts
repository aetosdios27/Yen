import { describe, expect, it } from "vitest";
import { loadSandboxConfig } from "./sandbox-config.js";

const templates = [
  "otp",
  "approval_needed",
  "approved_rejected",
  "donation_received",
  "objection_raised",
  "weekly_summary",
];
const environment = {
  YEN_DELIVERY_SANDBOX: "1",
  YEN_SANDBOX_PHONE: "+919876543210",
  WHATSAPP_API_BASE_URL: "https://graph.facebook.com",
  WHATSAPP_API_VERSION: "v99.0",
  WHATSAPP_PHONE_NUMBER_ID: "test-phone-id",
  WHATSAPP_ACCESS_TOKEN: "test-only-token",
  WHATSAPP_TEMPLATES_JSON: JSON.stringify(
    Object.fromEntries(
      templates.map((name) => [
        name,
        { name, language: "en", parameters: name === "otp" ? ["code"] : [] },
      ]),
    ),
  ),
  EXOTEL_SMS_ENDPOINT: "https://example.test/sms",
  EXOTEL_SMS_STATUS_CALLBACK_URL: "https://example.test/callback",
  EXOTEL_API_KEY: "test-only-key",
  EXOTEL_API_TOKEN: "test-only-token",
  EXOTEL_SENDER_ID: "test-sender",
  EXOTEL_DLT_ENTITY_ID: "test-entity",
  EXOTEL_SMS_TEMPLATES_JSON: JSON.stringify(
    Object.fromEntries(
      templates.map((name) => [
        name,
        {
          templateId: name,
          ...(name === "otp" ? { otpBody: { en: "Code {{code}}", hi: "Code {{code}}" } } : {}),
        },
      ]),
    ),
  ),
};

describe("provider sandbox safety gates", () => {
  it("skips without explicit opt-in or complete credentials", () => {
    expect(loadSandboxConfig({})).toBeNull();
    expect(loadSandboxConfig({ ...environment, YEN_DELIVERY_SANDBOX: undefined })).toBeNull();
    expect(loadSandboxConfig({ ...environment, EXOTEL_API_TOKEN: undefined })).toBeNull();
  });

  it.each(["true", "1", "false", ""])("never enables sends in CI (%s)", (CI) => {
    expect(loadSandboxConfig({ ...environment, CI })).toBeNull();
  });

  it("loads both real adapters only after local opt-in and complete configuration", () => {
    const config = loadSandboxConfig(environment);
    expect(config?.phone).toBe(environment.YEN_SANDBOX_PHONE);
    expect(config?.whatsapp.templates.otp?.parameters).toEqual(["code"]);
    expect(config?.sms.templates.otp?.otpBody?.en).toBe("Code {{code}}");
  });

  it("rejects invalid configuration without exposing its contents", () => {
    expect(() => loadSandboxConfig({ ...environment, WHATSAPP_TEMPLATES_JSON: "{}" })).toThrow(
      "Invalid delivery sandbox configuration",
    );
    expect(() => loadSandboxConfig({ ...environment, YEN_SANDBOX_PHONE: "private-phone" })).toThrow(
      "Invalid delivery sandbox configuration",
    );
  });
});
