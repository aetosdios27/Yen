import { type PhoneE164, parsePhoneE164 } from "@yen/shared";

/**
 * Normalizes user-entered phone numbers into canonical E.164 form.
 * Supports:
 * - Canonical E.164 (+919876543210, +14155552671)
 * - 10-digit Indian mobile numbers (9876543210, 98765 43210, 98765-43210) -> +919876543210
 * - Indian mobile with leading 0 (09876543210) -> +919876543210
 * - Indian mobile with leading 91 (919876543210) -> +919876543210
 */
export function normalizePhone(raw: unknown): PhoneE164 | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const compact = `+${trimmed.slice(1).replace(/[\s-]/g, "")}`;
    const result = parsePhoneE164(compact);
    return result.ok ? result.value : null;
  }
  const digits = trimmed.replace(/[\s-]/g, "");
  // 10-digit Indian mobile starting with 6-9
  if (/^[6-9]\d{9}$/.test(digits)) {
    const result = parsePhoneE164(`+91${digits}`);
    return result.ok ? result.value : null;
  }
  // 11-digit with leading 0
  if (/^0[6-9]\d{9}$/.test(digits)) {
    const result = parsePhoneE164(`+91${digits.slice(1)}`);
    return result.ok ? result.value : null;
  }
  // 12-digit with 91 prefix
  if (/^91[6-9]\d{9}$/.test(digits)) {
    const result = parsePhoneE164(`+${digits}`);
    return result.ok ? result.value : null;
  }
  return null;
}
