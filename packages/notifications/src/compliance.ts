/**
 * Regulatory compliance validation for outbound notification dispatches in India.
 *
 * Transactional SMS dispatches must carry DLT identifiers registered under TCCCPR,
 * and WhatsApp dispatches must reference BSP-approved utility templates with an
 * explicit language code. Every check fails closed: an unapproved variable, an
 * unknown template key, or a missing regulatory header blocks the dispatch.
 */

export const DLT_COMMUNICATION_TYPE = "TRANSACTIONAL" as const;
export const WHATSAPP_TEMPLATE_CATEGORY = "UTILITY" as const;

/** DLT entity and header identifiers are numeric strings issued by the telecom DLT registry. */
export const DLT_ID_PATTERN = /^[0-9]{10,25}$/;

/** DLT transactional SMS headers are six-character alphabetic sender IDs. */
export const DLT_SENDER_ID_PATTERN = /^[A-Z]{6}$/;

export interface ComplianceViolation {
  /** Stable machine-readable code, for example `missing_dlt_entity_id`. */
  code: string;
  /** Field or registry entry the violation is about. */
  field: string;
  /** Human-readable explanation. */
  message: string;
}

export interface ComplianceResult {
  compliant: boolean;
  violations: ComplianceViolation[];
}

/**
 * A DLT-registered SMS template. The registered body uses DLT variable
 * placeholders of the form `{#name#}` and must match the approved text exactly.
 * `dlt_template_id` stays empty until the telecom DLT registry issues the ID;
 * validation fails closed while it is empty.
 */
export interface SmsDltTemplateRegistration {
  template_key: string;
  dlt_template_id: string;
  registered_body: string;
  /** Variable names in the order their placeholders appear in the body. */
  variables: readonly string[];
  communication_type: typeof DLT_COMMUNICATION_TYPE;
}

/**
 * Registered DLT SMS templates. This track registers the login OTP template;
 * other notifications are delivered on WhatsApp only. Template IDs are filled
 * in after DLT approval, see docs/compliance/dlt-whatsapp-templates.md.
 */
export const SMS_DLT_TEMPLATE_REGISTRY: Readonly<
  Record<string, SmsDltTemplateRegistration>
> = {
  otp: {
    template_key: "otp",
    dlt_template_id: "",
    registered_body:
      "Your Yen club treasury login code is {#code#}. It is valid for 10 minutes. Do not share this code.",
    variables: ["code"],
    communication_type: DLT_COMMUNICATION_TYPE,
  },
};

/**
 * A BSP-approved WhatsApp template. The registered body uses Meta positional
 * placeholders (`{{1}}`, `{{2}}`, ...); the variable names list maps each
 * positional placeholder to a named parameter in registration order. Every
 * template in this registry is submitted in the UTILITY category.
 */
export interface WhatsAppTemplateRegistration {
  template_key: string;
  template_name: string;
  registered_body: string;
  /** Variable names ordered by positional placeholder index. */
  variables: readonly string[];
  category: typeof WHATSAPP_TEMPLATE_CATEGORY;
  /** Language codes with an approved template registration, BCP-47 format. */
  approved_language_codes: readonly string[];
}

/**
 * BSP-approved WhatsApp utility templates. Template names and bodies must stay
 * identical to the approved submissions, see docs/compliance/dlt-whatsapp-templates.md.
 */
export const WHATSAPP_TEMPLATE_REGISTRY: Readonly<
  Record<string, WhatsAppTemplateRegistration>
> = {
  otp: {
    template_key: "otp",
    template_name: "yen_login_otp",
    registered_body:
      "Your Yen club treasury login code is {{1}}. It is valid for 10 minutes. Do not share this code.",
    variables: ["code"],
    category: WHATSAPP_TEMPLATE_CATEGORY,
    approved_language_codes: ["en"],
  },
  approval_needed: {
    template_key: "approval_needed",
    template_name: "yen_expense_approval_required",
    registered_body:
      "Expense {{1}} of {{2}} in fund {{3}} is waiting for your approval before payout can start.",
    variables: ["expense_title", "amount_inr", "fund_title"],
    category: WHATSAPP_TEMPLATE_CATEGORY,
    approved_language_codes: ["en"],
  },
  approved_rejected: {
    template_key: "approved_rejected",
    template_name: "yen_expense_approved_payout_initiated",
    registered_body:
      "Expense {{1}} of {{2}} in fund {{3}} has been approved and the payout is now initiated.",
    variables: ["expense_title", "amount_inr", "fund_title"],
    category: WHATSAPP_TEMPLATE_CATEGORY,
    approved_language_codes: ["en"],
  },
  donation_received: {
    template_key: "donation_received",
    template_name: "yen_donation_pledge_verified",
    registered_body:
      "Your donation pledge of {{1}} to fund {{2}} is received and verified. Thank you for your support.",
    variables: ["amount_inr", "fund_title"],
    category: WHATSAPP_TEMPLATE_CATEGORY,
    approved_language_codes: ["en"],
  },
  objection_raised: {
    template_key: "objection_raised",
    template_name: "yen_expense_objection_raised",
    registered_body:
      "A public objection was raised on expense {{1}} in fund {{2}}. Review the objection before payout.",
    variables: ["expense_title", "fund_title"],
    category: WHATSAPP_TEMPLATE_CATEGORY,
    approved_language_codes: ["en"],
  },
};
