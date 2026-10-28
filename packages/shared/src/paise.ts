export declare const paiseBrand: unique symbol;

/** An integer number of paise (1 rupee = 100 paise). Never a float. */
export type Paise = number & { readonly [paiseBrand]: "Paise" };

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise must be a safe integer, got ${value}`);
  }
  return value as Paise;
}

export function addPaise(a: Paise, b: Paise): Paise {
  return paise(a + b);
}

/**
 * Converts a rupee amount (number or string representation) to integer Paise.
 * Avoids IEEE-754 binary floating-point precision pitfalls by exact parsing.
 */
export function toPaise(value: number | string): Paise {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Rupee amount must be finite, got ${value}`);
    }
    return paise(Math.round(value * 100));
  }

  const cleaned = value.replace(/,/g, "").replace(/^₹/, "").trim();
  if (cleaned === "") {
    throw new RangeError("Rupee amount cannot be empty");
  }

  const isNegative = cleaned.startsWith("-");
  const absStr = isNegative ? cleaned.slice(1) : cleaned;

  if (!/^\d+(\.\d{1,2})?$/.test(absStr)) {
    throw new RangeError(`Invalid rupee format: "${value}"`);
  }

  const [whole = "0", frac = ""] = absStr.split(".");
  const paiseVal = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise(isNegative ? -paiseVal : paiseVal);
}

const rupeeGrouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Formats paise as rupees with Indian digit grouping, without going through floats. */
export function formatInr(amount: Paise): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const rupees = Math.trunc(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}₹${rupeeGrouping.format(rupees)}.${remainder}`;
}
