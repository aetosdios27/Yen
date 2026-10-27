import { createHash } from "node:crypto";
import type { KontoTransactionExecutor } from "@konto-ledger/types";

export type FundAccountKind = "bank" | "donations" | "expenses" | "pending_spend";

export interface FundAccounts {
  fundId: string;
  bankId: string;
  donationsId: string;
  expensesId: string;
  pendingSpendId: string;
}

const YEN_NAMESPACE = "f71f5e2c-f985-43d8-a969-c2b6739f8dfd";

/**
 * Derives a deterministic RFC 4122 v5 UUID from a 16-byte UUID namespace and name.
 */
export function deterministicUuid(namespace: string, name: string): string {
  const cleanNs = namespace.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(cleanNs)) {
    throw new TypeError(`Invalid namespace UUID: ${namespace}`);
  }
  const nsBytes = Buffer.from(cleanNs, "hex");
  const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const byte6 = hash[6] ?? 0;
  hash[6] = (byte6 & 0x0f) | 0x50;
  const byte8 = hash[8] ?? 0;
  hash[8] = (byte8 & 0x3f) | 0x80;
  const hex = hash.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function fundAccountName(fundId: string, kind: FundAccountKind): string {
  return `fund:${fundId}:${kind}`;
}

export function fundAccountId(fundId: string, kind: FundAccountKind): string {
  return deterministicUuid(YEN_NAMESPACE, fundAccountName(fundId, kind));
}

export function getFundAccountIds(fundId: string): FundAccounts {
  return {
    fundId,
    bankId: fundAccountId(fundId, "bank"),
    donationsId: fundAccountId(fundId, "donations"),
    expensesId: fundAccountId(fundId, "expenses"),
    pendingSpendId: fundAccountId(fundId, "pending_spend"),
  };
}

export async function ensureFundAccounts(
  tx: KontoTransactionExecutor,
  fundId: string,
): Promise<FundAccounts> {
  const accounts = getFundAccountIds(fundId);

  await tx`
    INSERT INTO konto_accounts (id, name, account_type, currency)
    VALUES
      (${accounts.bankId}, ${fundAccountName(fundId, "bank")}, 'ASSET', 'INR'),
      (${accounts.donationsId}, ${fundAccountName(fundId, "donations")}, 'REVENUE', 'INR'),
      (${accounts.expensesId}, ${fundAccountName(fundId, "expenses")}, 'EXPENSE', 'INR'),
      (${accounts.pendingSpendId}, ${fundAccountName(fundId, "pending_spend")}, 'LIABILITY', 'INR')
    ON CONFLICT (id) DO NOTHING
  `;

  return accounts;
}
