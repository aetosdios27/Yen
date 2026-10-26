declare const paiseBrand: unique symbol;

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

const rupeeGrouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Formats paise as rupees with Indian digit grouping, without going through floats. */
export function formatInr(amount: Paise): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const rupees = Math.trunc(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}₹${rupeeGrouping.format(rupees)}.${remainder}`;
}
