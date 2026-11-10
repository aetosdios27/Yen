/**
 * Pure PII scrubbing for error payloads and client reports. Redacts Indian
 * phone numbers, UPI VPAs, session tokens, passwords, authorization headers
 * and cookies from free text and nested context objects. No environment or
 * I/O access so every branch is unit testable.
 */

export const REDACTED = "[redacted]";
export const REDACTED_PHONE = "[redacted:phone]";
export const REDACTED_VPA = "[redacted:vpa]";
export const REDACTED_TOKEN = "[redacted:session_token]";
export const REDACTED_AUTHORIZATION = "[redacted:authorization]";
export const REDACTED_COOKIE = "[redacted:cookie]";
export const TRUNCATED = "[truncated]";
export const MAX_SCRUB_DEPTH = 8;

// Indian mobile numbers: optional +91 / 91 / 0 prefix, 10 digits starting 6-9,
// with optional space or dash grouping inside the subscriber number.
const PHONE_PATTERN = /(?<!\d)(?:\+?91[\s-]?|0[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

// UPI VPA and email-like handles: local part @ provider.
const VPA_PATTERN = /\b[a-zA-Z0-9._-]{1,}@[a-zA-Z][a-zA-Z0-9.-]{1,}\b/g;

// Signed JWTs carry the session on every authenticated API call.
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

// Credential schemes on authorization-style headers.
const AUTH_SCHEME_PATTERN = /\b(?:bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

// Header-style pairs where the whole value after the key is a credential
// carrier (the cookie value itself is a key=value list of session tokens).
// Values already carrying a [redacted...] tag are left alone so an earlier
// rule's replacement is not rewritten a second time.
const CREDENTIAL_HEADER_PATTERN =
  /\b(set[-_ ]?cookie|cookie|authorization|auth|x-api-key|api-key)\s*[=:]\s*("[^"]*"|'[^']*'|(?!\[redacted)[^\s,;&}"]+)/gi;

// key=value or "key": value pairs whose values are credentials or contacts.
const KEY_VALUE_PATTERN =
  /("?[\w.-]*(?:password|passwd|pwd|passcode|otp|pin|token|secret|api[_-]?key|vpa|upi|utr|session|phone|mobile|contact|auth)[\w.-]*"?\s*[=:]\s*)("[^"]*"|'[^']*'|(?!\[redacted)[^\s,;&}"]+)/gi;

// Space separated credential mentions ("otp 530912"); a digit keeps words
// like "policy" from matching.
const SPACED_CREDENTIAL_PATTERN =
  /\b(password|passwd|otp|api[_-]?key|authorization|access[_-]?token|session[_-]?token)\s+(?=[^\s]*\d)[\w./+=-]{6,}/gi;

const KEY_VALUE_REPLACEMENT = "$1[redacted]";

const SENSITIVE_KEY_EXACT = new Set([
  "accountnumber",
  "aadhaar",
  "apikey",
  "auth",
  "authorization",
  "cardnumber",
  "contact",
  "cookie",
  "cvv",
  "email",
  "emailaddress",
  "idtoken",
  "ifsc",
  "mobile",
  "mobilenumber",
  "otp",
  "pan",
  "passcode",
  "passwd",
  "password",
  "phone",
  "phonenumber",
  "pin",
  "pwd",
  "refreshtoken",
  "session",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "sid",
  "token",
  "upi",
  "vpa",
]);

// Fragment matches cover compound keys such as sessionToken, userPhone,
// approvalPin and refresh_token; over-redaction in error payloads is safe.
const SENSITIVE_KEY_FRAGMENT =
  /(?:password|passwd|passcode|token|secret|authorization|cookie|session|otp|pin|phone|mobile|vpa|email|cvv|auth|contact|upi|utr|card|aadhaar|apikey)/;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized !== "" &&
    (SENSITIVE_KEY_EXACT.has(normalized) || SENSITIVE_KEY_FRAGMENT.test(normalized))
  );
}

/** Scrubs credentials and personal identifiers out of a free text string. */
export function scrubText(value: string): string {
  return value
    .replace(AUTH_SCHEME_PATTERN, REDACTED_AUTHORIZATION)
    .replace(JWT_PATTERN, REDACTED_TOKEN)
    .replace(CREDENTIAL_HEADER_PATTERN, (_match, key: string) => `${key}=${REDACTED_COOKIE}`)
    .replace(KEY_VALUE_PATTERN, KEY_VALUE_REPLACEMENT)
    .replace(SPACED_CREDENTIAL_PATTERN, "$1 [redacted]")
    .replace(VPA_PATTERN, REDACTED_VPA)
    .replace(PHONE_PATTERN, REDACTED_PHONE);
}

function scrubObject(
  value: Record<string, unknown>,
  seen: Set<object>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entry, seen, depth + 1);
  }
  return result;
}

/**
 * Deeply scrubs an error context object: strings inside are scrubbed and
 * values under credential-bearing keys are dropped entirely. Cycles and
 * overly deep trees collapse to [truncated] instead of recursing forever.
 */
export function scrubValue(value: unknown, seen: Set<object> = new Set(), depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SCRUB_DEPTH || seen.has(value)) return TRUNCATED;
  seen.add(value);
  try {
    if (value instanceof Error) {
      return {
        name: scrubText(value.name),
        message: scrubText(value.message),
        stack: scrubText(value.stack ?? ""),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, entry]) => [
          String(key),
          isSensitiveKey(String(key)) ? REDACTED : scrubValue(entry, seen, depth + 1),
        ]),
      );
    }
    if (value instanceof Set) return [...value].map((entry) => scrubValue(entry, seen, depth + 1));
    if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, seen, depth + 1));
    return scrubObject(value as Record<string, unknown>, seen, depth);
  } finally {
    seen.delete(value);
  }
}
