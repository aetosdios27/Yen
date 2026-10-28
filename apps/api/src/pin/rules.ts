export interface PinValidationContext {
  readonly phone?: string;
  readonly userId?: string;
  readonly yenId?: string;
}

export interface PinValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

const COMMON_PINS = new Set([
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123456",
  "654321",
  "012345",
  "543210",
  "121212",
  "112233",
  "123123",
  "696969",
  "123321",
  "111222",
  "131313",
  "242424",
  "101010",
  "987654",
  "876543",
  "765432",
  "234567",
  "345678",
  "456789",
]);

function isAscendingRun(pin: string): boolean {
  for (let i = 0; i < 5; i++) {
    const current = Number(pin[i]);
    const next = Number(pin[i + 1]);
    if (next !== (current + 1) % 10) return false;
  }
  return true;
}

function isDescendingRun(pin: string): boolean {
  for (let i = 0; i < 5; i++) {
    const current = Number(pin[i]);
    const next = Number(pin[i + 1]);
    if (next !== (current - 1 + 10) % 10) return false;
  }
  return true;
}

function isRepeatedPattern(pin: string): boolean {
  // All same digit (e.g. 111111)
  if (/^(.)\1{5}$/.test(pin)) return true;
  // 3 repeated 2-digit pairs (e.g. 121212, 454545)
  if (/^(\d{2})\1\1$/.test(pin)) return true;
  // 2 repeated 3-digit groups (e.g. 123123)
  if (/^(\d{3})\1$/.test(pin)) return true;
  // 3 consecutive double digits (e.g. 112233)
  if (/^(\d)\1(\d)\2(\d)\3$/.test(pin)) return true;
  return false;
}

function isDerivedFromIdentifier(pin: string, identifier?: string): boolean {
  if (!identifier) return false;
  const digits = identifier.replace(/\D/g, "");
  if (digits.length >= 6 && digits.includes(pin)) return true;
  const reversed = digits.split("").reverse().join("");
  if (reversed.length >= 6 && reversed.includes(pin)) return true;
  const normalized = identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes(pin)) return true;
  return false;
}

export function validatePin(pin: string, context?: PinValidationContext): PinValidationResult {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return { valid: false, reason: "PIN must be exactly 6 digits" };
  }

  if (COMMON_PINS.has(pin)) {
    return { valid: false, reason: "PIN is too common; choose a less predictable PIN" };
  }

  if (isRepeatedPattern(pin)) {
    return { valid: false, reason: "PIN cannot be repeating digits or patterns" };
  }

  if (isAscendingRun(pin)) {
    return { valid: false, reason: "PIN cannot be an ascending run of numbers" };
  }

  if (isDescendingRun(pin)) {
    return { valid: false, reason: "PIN cannot be a descending run of numbers" };
  }

  if (context?.phone && isDerivedFromIdentifier(pin, context.phone)) {
    return { valid: false, reason: "PIN cannot be derived from your phone number" };
  }

  if (context?.userId && isDerivedFromIdentifier(pin, context.userId)) {
    return { valid: false, reason: "PIN cannot be derived from your user ID" };
  }

  if (context?.yenId && isDerivedFromIdentifier(pin, context.yenId)) {
    return { valid: false, reason: "PIN cannot be derived from your Yen ID" };
  }

  return { valid: true };
}
