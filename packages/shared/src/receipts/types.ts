import type { Paise } from "../paise.js";

export type { DonationStatus as DonationReceiptStatus } from "../donation-status.js";

import type { DonationStatus as DonationReceiptStatus } from "../donation-status.js";

export const RECEIPT_DISCLAIMER_EN =
  "This receipt is proof of a voluntary contribution to the community fund and is NOT a tax-exempt receipt under Section 80G of the Income Tax Act.";

export const RECEIPT_DISCLAIMER_HI =
  "यह रसीद समुदाय निधि में स्वैच्छिक योगदान का प्रमाण है और आयकर अधिनियम की धारा 80G के तहत कर छूट रसीद नहीं है।";

export interface DonorReceiptData {
  readonly donationId: string;
  readonly fundId: string;
  readonly fundTitle: string;
  readonly amountPaise: Paise;
  readonly utr: string;
  readonly status: DonationReceiptStatus;
  readonly donorDisplayName?: string | null | undefined;
  readonly donorNameChoice?: "full" | "initials" | "anonymous" | undefined;
  readonly createdAt: string;
  readonly refundedAt?: string | null | undefined;
  readonly verifiedAt?: string | null | undefined;
  readonly proofUrl?: string | undefined;
  readonly onChainRoot?: string | undefined;
  readonly onChainTxHash?: string | undefined;
  readonly isTaxReceipt: false;
  readonly disclaimerEn: string;
  readonly disclaimerHi: string;
}

export function receiptStatusLabels(status: DonationReceiptStatus) {
  switch (status) {
    case "pledged":
      return {
        en: "RECORDED (WAITING FOR BANK)",
        hi: "दर्ज (बैंक मिलान प्रतीक्षारत)",
        verified: false,
        proof: "Awaiting bank statement",
      };
    case "verified":
      return {
        en: "VERIFIED CONTRIBUTION",
        hi: "सत्यापित योगदान",
        verified: true,
        proof: "Tamper-evident record",
      };
    case "rejected":
      return {
        en: "REJECTED CONTRIBUTION",
        hi: "अस्वीकृत योगदान",
        verified: false,
        proof: "Rejected record",
      };
    case "refunded":
      return {
        en: "REFUNDED CONTRIBUTION",
        hi: "योगदान वापस किया गया",
        verified: false,
        proof: "Received and refunded record",
      };
  }
  const exhaustive: never = status;
  throw new Error(`Unknown receipt status: ${exhaustive}`);
}
