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
