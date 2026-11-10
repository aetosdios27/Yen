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
export const SMS_DLT_TEMPLATE_REGISTRY: Readonly<Record<string, SmsDltTemplateRegistration>> = {
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
export const WHATSAPP_TEMPLATE_REGISTRY: Readonly<Record<string, WhatsAppTemplateRegistration>> = {
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

const DLT_PLACEHOLDER_PATTERN = /\{#([a-zA-Z0-9_]+)#\}/g;

function complianceFailure(violations: ComplianceViolation[]): ComplianceResult {
  return { compliant: false, violations };
}

export interface SmsDispatchInput {
  template_key: string;
  recipient: string;
  dlt_entity_id?: string | null;
  dlt_template_id?: string | null;
  sender_id?: string | null;
  variables: Readonly<Record<string, string>>;
}

export type SmsDispatchRegistry = Readonly<Record<string, SmsDltTemplateRegistration>>;

/**
 * Renders a registered DLT body with the given variables. Throws when a
 * required variable is missing so callers cannot send a partially rendered
 * registered message.
 */
export function renderDltRegisteredBody(
  registration: SmsDltTemplateRegistration,
  variables: Readonly<Record<string, string>>,
): string {
  return registration.registered_body.replace(DLT_PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === "") {
      throw new Error(`DLT template variable is missing: ${name}`);
    }
    return value;
  });
}

function checkVariables(
  registeredVariables: readonly string[],
  variables: Readonly<Record<string, string>>,
  fieldPrefix: string,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  const allowed = new Set(registeredVariables);
  for (const key of Object.keys(variables).sort()) {
    if (!allowed.has(key)) {
      violations.push({
        code: "unapproved_variable",
        field: `${fieldPrefix}.${key}`,
        message: `Variable ${key} is not part of the registered template`,
      });
    }
  }
  for (const key of registeredVariables) {
    const value = variables[key];
    if (value === undefined) {
      violations.push({
        code: "missing_variable",
        field: `${fieldPrefix}.${key}`,
        message: `Registered template variable ${key} is missing`,
      });
    } else if (value === "") {
      violations.push({
        code: "empty_variable",
        field: `${fieldPrefix}.${key}`,
        message: `Registered template variable ${key} is empty`,
      });
    }
  }
  return violations;
}

/**
 * Validates an outbound SMS dispatch against TCCCPR DLT requirements: a
 * registered entity ID, a valid transactional sender header, a registered
 * template ID, and variables limited to the approved set. Fails closed on any
 * missing or malformed regulatory input.
 */
export function validateSmsDispatch(
  input: SmsDispatchInput,
  registry: SmsDispatchRegistry = SMS_DLT_TEMPLATE_REGISTRY,
): ComplianceResult {
  const violations: ComplianceViolation[] = [];

  const entityId = input.dlt_entity_id?.trim() ?? "";
  if (!entityId) {
    violations.push({
      code: "missing_dlt_entity_id",
      field: "dlt_entity_id",
      message: "DLT entity ID is required on every outgoing SMS dispatch",
    });
  } else if (!DLT_ID_PATTERN.test(entityId)) {
    violations.push({
      code: "invalid_dlt_entity_id",
      field: "dlt_entity_id",
      message: "DLT entity ID must be the numeric identifier issued by the DLT registry",
    });
  }

  const senderId = input.sender_id?.trim() ?? "";
  if (!senderId) {
    violations.push({
      code: "missing_dlt_sender_id",
      field: "sender_id",
      message: "DLT sender header is required on every outgoing SMS dispatch",
    });
  } else if (!DLT_SENDER_ID_PATTERN.test(senderId)) {
    violations.push({
      code: "invalid_dlt_sender_id",
      field: "sender_id",
      message: "DLT transactional sender header must be six alphabetic characters",
    });
  }

  const templateId = input.dlt_template_id?.trim() ?? "";
  if (!templateId) {
    violations.push({
      code: "missing_dlt_template_id",
      field: "dlt_template_id",
      message: "DLT template ID is required on every outgoing SMS dispatch",
    });
  }

  const registration = registry[input.template_key];
  if (!registration) {
    violations.push({
      code: "unregistered_template",
      field: "template_key",
      message: `Template ${input.template_key} has no registered DLT template`,
    });
    return complianceFailure(violations);
  }

  if (registration.dlt_template_id === "") {
    violations.push({
      code: "template_registration_incomplete",
      field: "dlt_template_id",
      message: `Template ${input.template_key} has no DLT template ID issued yet`,
    });
  } else if (templateId && templateId !== registration.dlt_template_id) {
    violations.push({
      code: "dlt_template_id_mismatch",
      field: "dlt_template_id",
      message: `DLT template ID does not match the registered ID for ${input.template_key}`,
    });
  }

  violations.push(...checkVariables(registration.variables, input.variables, "variables"));

  return { compliant: violations.length === 0, violations };
}

export interface WhatsAppDispatchInput {
  template_key: string;
  recipient: string;
  template_name?: string | null;
  language_code?: string | null;
  variables: Readonly<Record<string, string>>;
}

export type WhatsAppDispatchRegistry = Readonly<Record<string, WhatsAppTemplateRegistration>>;

/**
 * Validates an outbound WhatsApp dispatch against BSP template approval rules:
 * the approved template name, an approved language code, and variables limited
 * to the registered positional set. Fails closed on any missing input.
 */
export function validateWhatsAppDispatch(
  input: WhatsAppDispatchInput,
  registry: WhatsAppDispatchRegistry = WHATSAPP_TEMPLATE_REGISTRY,
): ComplianceResult {
  const violations: ComplianceViolation[] = [];

  const registration = registry[input.template_key];
  if (!registration) {
    violations.push({
      code: "unregistered_template",
      field: "template_key",
      message: `Template ${input.template_key} has no approved WhatsApp template`,
    });
    return complianceFailure(violations);
  }

  const templateName = input.template_name?.trim() ?? "";
  if (!templateName) {
    violations.push({
      code: "missing_whatsapp_template_name",
      field: "template_name",
      message: "WhatsApp template name is required on every outgoing dispatch",
    });
  } else if (templateName !== registration.template_name) {
    violations.push({
      code: "whatsapp_template_name_mismatch",
      field: "template_name",
      message: `WhatsApp template name does not match the approved name for ${input.template_key}`,
    });
  }

  const languageCode = input.language_code?.trim() ?? "";
  if (!languageCode) {
    violations.push({
      code: "missing_whatsapp_language_code",
      field: "language_code",
      message: "WhatsApp language code is required on every outgoing dispatch",
    });
  } else if (!registration.approved_language_codes.includes(languageCode)) {
    violations.push({
      code: "unapproved_language_code",
      field: "language_code",
      message: `Language ${languageCode} has no approved registration for ${input.template_key}`,
    });
  }

  violations.push(...checkVariables(registration.variables, input.variables, "variables"));

  return { compliant: violations.length === 0, violations };
}

/** Ordered WhatsApp body parameters for the Graph API template component. */
export function buildWhatsAppBodyParameters(
  registration: WhatsAppTemplateRegistration,
  variables: Readonly<Record<string, string>>,
): { type: "text"; text: string }[] {
  return registration.variables.map((name) => {
    const value = variables[name];
    if (value === undefined || value === "") {
      throw new Error(`WhatsApp template variable is missing: ${name}`);
    }
    return { type: "text" as const, text: value };
  });
}

export interface SmsDispatchEnvelope {
  recipient: string;
  sender_id: string;
  dlt_entity_id: string;
  dlt_template_id: string;
  message: string;
}

/**
 * Validates a dispatch and renders the registered SMS body into a dispatch
 * envelope carrying the DLT regulatory headers. Returns the violations when
 * the dispatch is not compliant.
 */
export function buildSmsDispatchEnvelope(
  input: SmsDispatchInput,
  registry: SmsDispatchRegistry = SMS_DLT_TEMPLATE_REGISTRY,
): { ok: true; envelope: SmsDispatchEnvelope } | { ok: false; violations: ComplianceViolation[] } {
  const result = validateSmsDispatch(input, registry);
  if (!result.compliant) return { ok: false, violations: result.violations };
  const registration = registry[input.template_key];
  if (!registration) return { ok: false, violations: result.violations };
  return {
    ok: true,
    envelope: {
      recipient: input.recipient,
      sender_id: (input.sender_id ?? "").trim(),
      dlt_entity_id: (input.dlt_entity_id ?? "").trim(),
      dlt_template_id: registration.dlt_template_id,
      message: renderDltRegisteredBody(registration, input.variables),
    },
  };
}

/** WhatsApp Cloud API template message payload structure. */
export interface WhatsAppTemplatePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: { type: "body"; parameters: { type: "text"; text: string }[] }[];
  };
}

/**
 * Validates a dispatch and builds the WhatsApp Cloud API template payload.
 * Returns the violations when the dispatch is not compliant.
 */
export function buildWhatsAppTemplatePayload(
  input: WhatsAppDispatchInput,
  registry: WhatsAppDispatchRegistry = WHATSAPP_TEMPLATE_REGISTRY,
):
  | {
      ok: true;
      payload: WhatsAppTemplatePayload;
    }
  | { ok: false; violations: ComplianceViolation[] } {
  const result = validateWhatsAppDispatch(input, registry);
  if (!result.compliant) return { ok: false, violations: result.violations };
  const registration = registry[input.template_key];
  if (!registration) return { ok: false, violations: result.violations };
  return {
    ok: true,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.recipient,
      type: "template",
      template: {
        name: registration.template_name,
        language: { code: (input.language_code ?? "").trim() },
        components: [
          { type: "body", parameters: buildWhatsAppBodyParameters(registration, input.variables) },
        ],
      },
    },
  };
}
