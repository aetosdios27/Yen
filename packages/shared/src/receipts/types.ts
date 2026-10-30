import type { Paise } from "../paise.js";

export type DonationReceiptStatus = "pledged" | "verified" | "rejected";

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
  readonly verifiedAt?: string | null | undefined;
  readonly proofUrl?: string | undefined;
  readonly onChainRoot?: string | undefined;
  readonly onChainTxHash?: string | undefined;
  readonly isTaxReceipt: false;
  readonly disclaimerEn: string;
  readonly disclaimerHi: string;
}
