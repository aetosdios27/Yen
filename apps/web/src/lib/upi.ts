export interface UpiPayment {
  readonly upiVpa: string;
  readonly payeeName: string;
  readonly amountPaise?: number;
  readonly note?: string;
}

/** "1234.50" from paise, using integer arithmetic only. */
export function paiseToRupeeString(amountPaise: number): string {
  const rupees = Math.trunc(amountPaise / 100);
  const paise = amountPaise % 100;
  return `${rupees}.${String(paise).padStart(2, "0")}`;
}

/** Reads "1,299.5" as 129950 paise; null unless it is a positive whole amount. */
export function parseRupeeString(value: string): number | null {
  const cleaned = value.replace(/[,\s₹]/g, "");
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const [rupees = "", paise = ""] = cleaned.split(".");
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** The `upi://pay` link every Indian payment app understands. */
export function upiIntent(payment: UpiPayment): string {
  const params = new URLSearchParams({
    pa: payment.upiVpa,
    pn: payment.payeeName,
    cu: "INR",
  });
  if (payment.amountPaise !== undefined) {
    params.set("am", paiseToRupeeString(payment.amountPaise));
  }
  if (payment.note !== undefined) params.set("tn", payment.note);
  return `upi://pay?${params.toString()}`;
}
