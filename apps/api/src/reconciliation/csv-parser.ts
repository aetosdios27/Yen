import { type Paise, paise } from "@yen/shared";
import type { ParsedBankTransaction, TransactionType } from "./types.js";

/**
 * Converts a rupee string (e.g. "1,500.50", "500", "0.25") into integer Paise without floating-point math.
 */
export function parseRupeesToPaise(raw: string): Paise {
  const clean = raw.replace(/[₹$,\s]/g, "").trim();
  if (!clean || clean === "-" || clean === "0") {
    return paise(0);
  }
  const parts = clean.split(".");
  const rupeesPart = parts[0] || "0";
  const paisePart = (parts[1] || "00").padEnd(2, "0").slice(0, 2);

  const rupeesBig = BigInt(rupeesPart);
  const paiseBig = BigInt(paisePart);
  const total = Number(rupeesBig * 100n + paiseBig);

  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`Invalid currency amount: ${raw}`);
  }
  return paise(total);
}

/**
 * Extracts a 12-digit UPI UTR from narration or reference strings.
 * Typical Indian UPI narrations:
 * "UPI/CR/123456789012/PAYEE/..."
 * "UPI/DR/123456789012/..."
 * "123456789012/UPI/..."
 * "UPI-123456789012"
 */
export function extractUtr(narrationOrRef: string): string | undefined {
  // Prefer UTR explicitly tagged with UPI
  const upiMatch = /(?:UPI[/-](?:CR|DR)[/-]|UPI[/-]|UPI:)([0-9]{12})\b/i.exec(narrationOrRef);
  if (upiMatch?.[1]) {
    return upiMatch[1];
  }
  // Fall back to any standalone 12-digit sequence
  const standaloneMatch = /\b([0-9]{12})\b/.exec(narrationOrRef);
  return standaloneMatch?.[1];
}

/**
 * Extracts counterparty UPI VPA (e.g. donor@okhdfcbank) from narration if present.
 */
export function extractVpa(text: string): string | undefined {
  const match = /(?:^|[/ -])([a-zA-Z0-9._]{2,64}@[a-zA-Z]{2,64})(?:[/ -]|$)/.exec(text);
  return match?.[1];
}

/**
 * Parses various Indian bank statement date formats into ISO-8601 UTC string.
 * Supports:
 * - DD/MM/YYYY or DD-MM-YYYY
 * - YYYY-MM-DD
 * - DD/MM/YY
 * - DD Mon YYYY (e.g. "28 Oct 2026")
 */
export function parseBankDate(raw: string): string {
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(trimmed);
  if (dmyMatch?.[1] && dmyMatch[2] && dmyMatch[3]) {
    const day = Number.parseInt(dmyMatch[1], 10);
    const month = Number.parseInt(dmyMatch[2], 10) - 1;
    const year = Number.parseInt(dmyMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return d.toISOString();
  }

  // DD/MM/YY
  const dmyShortMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(trimmed);
  if (dmyShortMatch?.[1] && dmyShortMatch[2] && dmyShortMatch[3]) {
    const day = Number.parseInt(dmyShortMatch[1], 10);
    const month = Number.parseInt(dmyShortMatch[2], 10) - 1;
    const year = 2000 + Number.parseInt(dmyShortMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return d.toISOString();
  }

  // Fallback Date parser
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  throw new Error(`Unable to parse bank date: ${raw}`);
}

/**
 * Splits CSV text into an array of rows and cell tokens, handling quoted strings with commas.
 */
export function parseCsvRows(csvText: string): string[][] {
  const lines = csvText.split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }

  return rows;
}

/**
 * Parses standard bank statement CSV into normalized ParsedBankTransaction records.
 */
export function parseBankStatementCsv(csvContent: string, fundId: string): ParsedBankTransaction[] {
  const rows = parseCsvRows(csvContent);
  if (rows.length < 2) {
    return [];
  }

  // Find header row (first row with Date / Txn Date / Narration / Description)
  let headerIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const lower = row.map((c) => c.toLowerCase());
    if (
      lower.some((c) => c.includes("date")) &&
      (lower.some(
        (c) => c.includes("narration") || c.includes("description") || c.includes("details"),
      ) ||
        lower.some((c) => c.includes("deposit") || c.includes("credit") || c.includes("amount")))
    ) {
      headerIndex = i;
      headers = lower;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Invalid bank statement CSV: header row not recognized");
  }

  // Column index resolvers
  const dateCol = headers.findIndex(
    (h) =>
      h === "date" || h === "txn date" || h.includes("txn date") || h.includes("transaction date"),
  );
  const narrationCol = headers.findIndex(
    (h) =>
      h.includes("narration") ||
      h.includes("description") ||
      h.includes("particular") ||
      h.includes("details"),
  );
  const refCol = headers.findIndex(
    (h) => h.includes("chq") || h.includes("ref") || h.includes("utr") || h.includes("cheque"),
  );
  const depositCol = headers.findIndex(
    (h) => h.includes("deposit") || h.includes("credit") || h.includes("cr amt"),
  );
  const withdrawalCol = headers.findIndex(
    (h) => h.includes("withdrawal") || h.includes("debit") || h.includes("dr amt"),
  );
  const amountCol = headers.findIndex((h) => h === "amount" || h.includes("txn amt"));
  const typeCol = headers.findIndex((h) => h === "type" || h.includes("cr/dr"));

  const transactions: ParsedBankTransaction[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const rawDate = row[Math.max(dateCol, 0)] || "";
    if (
      !rawDate ||
      rawDate.toLowerCase().includes("total") ||
      rawDate.toLowerCase().includes("opening") ||
      rawDate.toLowerCase().includes("closing")
    ) {
      continue;
    }

    let postedAt: string;
    try {
      postedAt = parseBankDate(rawDate);
    } catch {
      // Non-transaction summary row, skip
      continue;
    }

    const narration = narrationCol >= 0 ? row[narrationCol] || "" : "";
    const rawRef = refCol >= 0 ? row[refCol] || "" : "";

    let type: TransactionType = "credit";
    let amount = paise(0);

    // Scenario A: Separate Deposit / Withdrawal columns
    if (depositCol >= 0 || withdrawalCol >= 0) {
      const depositRaw = depositCol >= 0 ? row[depositCol] || "" : "";
      const withdrawalRaw = withdrawalCol >= 0 ? row[withdrawalCol] || "" : "";

      const depositPaise = parseRupeesToPaise(depositRaw);
      const withdrawalPaise = parseRupeesToPaise(withdrawalRaw);

      if (depositPaise > 0) {
        type = "credit";
        amount = depositPaise;
      } else if (withdrawalPaise > 0) {
        type = "debit";
        amount = withdrawalPaise;
      } else {
        // Zero amount row
        continue;
      }
    } else if (amountCol >= 0) {
      // Scenario B: Single Amount column with Type indicator
      const amtRaw = row[amountCol] || "";
      amount = parseRupeesToPaise(amtRaw);
      if (amount <= 0) continue;

      const typeIndicator = typeCol >= 0 ? (row[typeCol] || "").toUpperCase() : "";
      if (typeIndicator.includes("DR") || typeIndicator.includes("DEBIT")) {
        type = "debit";
      } else {
        type = "credit";
      }
    } else {
      continue;
    }

    // Reference & UTR resolution
    const utr = extractUtr(`${rawRef} ${narration}`);
    const bankReference =
      rawRef && rawRef !== "-"
        ? rawRef
        : utr
          ? `UPI-${utr}`
          : `STMT-${fundId.slice(0, 8)}-${postedAt.slice(0, 10)}-${i}`;

    const counterpartyVpa = extractVpa(narration);

    transactions.push({
      fundId,
      bankReference,
      utr,
      amountPaise: amount,
      type,
      postedAt,
      narration: narration || undefined,
      counterpartyVpa,
      source: "statement_upload",
      rawPayload: {
        rowNumber: i + 1,
        rawRow: row,
        headers,
      },
    });
  }

  return transactions;
}
