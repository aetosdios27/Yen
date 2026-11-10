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
