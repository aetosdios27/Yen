import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  extractUtr,
  extractVpa,
  parseBankDate,
  parseBankStatementCsv,
  parseRupeesToPaise,
} from "./csv-parser.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));

describe("CSV Statement Parser", () => {
  it("converts rupees to paise without floating-point errors", () => {
    expect(parseRupeesToPaise("500.00")).toBe(paise(50000));
    expect(parseRupeesToPaise("1,50,000.50")).toBe(paise(15000050));
    expect(parseRupeesToPaise("0.75")).toBe(paise(75));
    expect(parseRupeesToPaise("100")).toBe(paise(10000));
    expect(parseRupeesToPaise("₹ 2,500.00")).toBe(paise(250000));
    expect(parseRupeesToPaise("")).toBe(paise(0));
    expect(parseRupeesToPaise("-")).toBe(paise(0));
  });

  it("extracts 12-digit UPI UTR and counterparty VPA from narrations", () => {
    expect(extractUtr("UPI/CR/123456789012/DONOR/PAYTM")).toBe("123456789012");
    expect(extractUtr("UPI-987654321098-donor@okhdfcbank")).toBe("987654321098");
    expect(extractUtr("NEFT-N12345678901")).toBeUndefined();
    expect(extractVpa("UPI-987654321098-donor@okhdfcbank-FESTIVAL")).toBe("donor@okhdfcbank");
  });

  it("parses DD/MM/YYYY and DD-MM-YYYY dates", () => {
    expect(parseBankDate("28/10/2026")).toBe(
      new Date(Date.UTC(2026, 9, 28, 12, 0, 0)).toISOString(),
    );
    expect(parseBankDate("28-10-2026")).toBe(
      new Date(Date.UTC(2026, 9, 28, 12, 0, 0)).toISOString(),
    );
    expect(parseBankDate("2026-10-28T14:30:00.000Z")).toBe("2026-10-28T14:30:00.000Z");
  });

  it("parses realistic HDFC bank statement fixture", async () => {
    const csvContent = await readFile(
      join(currentDir, "fixtures/sandbox-hdfc-statement.csv"),
      "utf8",
    );
    const fundId = "e3fb2fc4-03f9-f5b1-bcef-464ab0d87ddd";

    const txs = parseBankStatementCsv(csvContent, fundId);
    expect(txs.length).toBe(6);

    // Row 1: UPI Credit
    expect(txs[0]).toMatchObject({
      fundId,
      bankReference: "123456789012",
      utr: "123456789012",
      amountPaise: paise(50000),
      type: "credit",
      source: "statement_upload",
    });

    // Row 3: NEFT Credit (non-UPI)
    expect(txs[2]).toMatchObject({
      fundId,
      bankReference: "N12345678901",
      amountPaise: paise(5000000),
      type: "credit",
      source: "statement_upload",
    });

    // Row 4: UPI Debit
    expect(txs[3]).toMatchObject({
      fundId,
      bankReference: "345678901234",
      utr: "345678901234",
      amountPaise: paise(35000),
      type: "debit",
      source: "statement_upload",
    });
  });

  it("parses realistic ICICI bank statement fixture", async () => {
    const csvContent = await readFile(
      join(currentDir, "fixtures/sandbox-icici-statement.csv"),
      "utf8",
    );
    const fundId = "e3fb2fc4-03f9-f5b1-bcef-464ab0d87ddd";

    const txs = parseBankStatementCsv(csvContent, fundId);
    expect(txs.length).toBe(3);

    expect(txs[0]).toMatchObject({
      fundId,
      bankReference: "678901234567",
      utr: "678901234567",
      amountPaise: paise(75000),
      type: "credit",
      counterpartyVpa: "donor1@icici",
      source: "statement_upload",
    });

    expect(txs[2]).toMatchObject({
      fundId,
      bankReference: "TXN998877",
      amountPaise: paise(120000),
      type: "debit",
      source: "statement_upload",
    });
  });
});
