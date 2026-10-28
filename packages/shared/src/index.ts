export {
  calculateGstinChecksum,
  GSTIN_ALPHABET,
  GSTIN_REGEX,
  type Gstin,
  gstinSchema,
  isValidGstinFormat,
  parseGstin,
  validateGstinChecksum,
} from "./gstin.js";
export {
  type FundId,
  fundIdSchema,
  type OrgId,
  orgIdSchema,
  type PseudonymId,
  parseFundId,
  parseOrgId,
  parsePseudonymId,
  parseUserId,
  pseudonymIdSchema,
  type UserId,
  userIdSchema,
} from "./ids.js";
export { fromHex, type Hash32, hash32, type Salt32, salt32, sha256, toHex } from "./merkle/hash.js";
export {
  buildIntervalTree,
  type IntervalEvent,
  type IntervalFund,
  type IntervalTree,
  proveEvent,
  verifyEventProof,
} from "./merkle/interval.js";
export {
  type EventProof,
  parseEventProof,
  parseEventProofJson,
  parseHash32,
  parseInclusionProof,
  parseSalt32,
  type Result,
  serializeEventProof,
} from "./merkle/proof.js";
export {
  type InclusionProof,
  leafHash,
  merkleRoot,
  proveInclusion,
  verifyInclusion,
} from "./merkle/tree.js";
export { addPaise, formatInr, type Paise, paise } from "./paise.js";
export { paiseWire } from "./paise-wire.js";
export { type PhoneE164, parsePhoneE164 } from "./phone.js";
export function parseGstin(
  value: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string } {
  const normalized = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) {
    return { ok: false, error: "Invalid GSTIN format" };
  }
  if (!validateGstinChecksum(normalized)) {
    return { ok: false, error: "Invalid GSTIN checksum" };
  }
  return { ok: true, value: normalized };
}
export function validateGstinChecksum(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  let factor = 2;
  for (let index = normalized.length - 2; index >= 0; index -= 1) {
    const digit = alphabet.indexOf(normalized[index] ?? "");
    if (digit < 0) return false;
    const product = digit * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  const check = (36 - (sum % 36)) % 36;
  return normalized.at(-1) === alphabet[check];
}
export {
  type RootRegistryAddress,
  rootRegistryAbi,
  rootRegistryAddress,
} from "./registry/abi.js";
