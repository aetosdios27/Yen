import type { Sql, TransactionSql } from "@yen/db";
import type { EvidenceStore, StoredEvidence } from "./stores.js";

type EvidenceRow = {
  readonly evidence_id: string;
  readonly expense_id: string;
  readonly fund_id: string;
  readonly file_sha256: string;
  readonly file_size_bytes: number;
  readonly content_type: StoredEvidence["mimeType"];
  readonly file_name: string;
  readonly storage_key: string;
  readonly scan_result: "clean";
  readonly scanner_name: string;
  readonly signature_version: string;
  readonly vendor_name: string | null;
  readonly gstin: string | null;
  readonly invoice_number: string | null;
  readonly invoice_date: string | null;
  readonly created_at: Date;
  readonly duplicate_expense_id: string | null;
};

function toStoredEvidence(row: EvidenceRow): StoredEvidence {
  const duplicateExpenseId = row.duplicate_expense_id ?? undefined;
  return {
    evidenceId: row.evidence_id,
    fundId: row.fund_id,
    expenseId: row.expense_id,
    fileSha256: row.file_sha256,
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.content_type,
    fileName: row.file_name,
    objectKey: row.storage_key,
    duplicateDetected: duplicateExpenseId !== undefined,
    isDuplicate: duplicateExpenseId !== undefined,
    duplicateExpenseId,
    ...(row.vendor_name === null ? {} : { vendorName: row.vendor_name }),
    ...(row.gstin === null ? {} : { gstin: row.gstin }),
    ...(row.invoice_number === null ? {} : { invoiceNumber: row.invoice_number }),
    ...(row.invoice_date === null ? {} : { invoiceDate: row.invoice_date }),
    createdAt: row.created_at.toISOString(),
    scan: {
      scannerName: row.scanner_name,
      signatureVersion: row.signature_version,
      result: row.scan_result,
    },
  };
}

async function selectById(sql: Sql | TransactionSql, evidenceId: string): Promise<EvidenceRow> {
  const rows = await sql<EvidenceRow[]>`
    SELECT evidence.evidence_id, evidence.expense_id, parent_fund.fund_id AS fund_id,
      evidence.file_sha256, evidence.file_size_bytes, evidence.content_type,
      evidence.file_name, evidence.storage_key, evidence.scan_result,
      evidence.scanner_name, evidence.signature_version, evidence.vendor_name,
      evidence.gstin, evidence.invoice_number, evidence.invoice_date,
      evidence.created_at, duplicate.expense_id AS duplicate_expense_id
    FROM evidence_records AS evidence
    JOIN expenses AS parent_fund ON parent_fund.id = evidence.expense_id
    LEFT JOIN LATERAL (
      SELECT candidate.expense_id
      FROM evidence_records AS candidate
      JOIN expenses AS candidate_expense ON candidate_expense.id = candidate.expense_id
      WHERE candidate.file_sha256 = evidence.file_sha256
        AND candidate_expense.fund_id = parent_fund.fund_id
        AND candidate.expense_id <> evidence.expense_id
      ORDER BY candidate.created_at, candidate.evidence_id
      LIMIT 1
    ) AS duplicate ON true
    WHERE evidence.evidence_id = ${evidenceId}
  `;
  const row = rows[0];
  if (!row) throw new Error("Evidence record was not found after insert");
  return row;
}

export class PostgresEvidenceStore implements EvidenceStore {
  constructor(private readonly sql: Sql) {}

  async expenseBelongsToFund(fundId: string, expenseId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id FROM expenses WHERE id = ${expenseId} AND fund_id = ${fundId}
    `;
    return rows.length > 0;
  }

  async save(evidence: StoredEvidence): Promise<StoredEvidence> {
    const objectKey = evidence.objectKey;
    if (!objectKey) throw new Error("Evidence storage key is required");

    return this.sql.begin(async (tx) => {
      const expenses = await tx<{ fund_id: string }[]>`
        SELECT fund_id FROM expenses WHERE id = ${evidence.expenseId} FOR SHARE
      `;
      const fundId = expenses[0]?.fund_id;
      if (!fundId) throw new Error("Evidence expense was not found");
      if (fundId !== evidence.fundId) throw new Error("Evidence fund does not match its expense");

      const lockKey = `${fundId}:${evidence.fileSha256}`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      await tx`
        INSERT INTO evidence_records (
          evidence_id, expense_id, file_sha256, file_size_bytes, content_type,
          file_name, storage_key, scan_result, scanner_name, signature_version,
          vendor_name, gstin, invoice_number, invoice_date, created_at
        ) VALUES (
          ${evidence.evidenceId}, ${evidence.expenseId}, ${evidence.fileSha256},
          ${evidence.fileSizeBytes}, ${evidence.mimeType}, ${evidence.fileName},
          ${objectKey}, ${evidence.scan.result}, ${evidence.scan.scannerName},
          ${evidence.scan.signatureVersion}, ${evidence.vendorName ?? null},
          ${evidence.gstin ?? null}, ${evidence.invoiceNumber ?? null},
          ${evidence.invoiceDate ?? null}, ${new Date(evidence.createdAt)}
        )
      `;
      return toStoredEvidence(await selectById(tx, evidence.evidenceId));
    });
  }

  async getByExpense(fundId: string, expenseId: string): Promise<readonly StoredEvidence[]> {
    const rows = await this.sql<EvidenceRow[]>`
      SELECT evidence.evidence_id, evidence.expense_id, parent_fund.fund_id AS fund_id,
        evidence.file_sha256, evidence.file_size_bytes, evidence.content_type,
        evidence.file_name, evidence.storage_key, evidence.scan_result,
        evidence.scanner_name, evidence.signature_version, evidence.vendor_name,
        evidence.gstin, evidence.invoice_number, evidence.invoice_date,
        evidence.created_at, duplicate.expense_id AS duplicate_expense_id
      FROM evidence_records AS evidence
      JOIN expenses AS parent_fund ON parent_fund.id = evidence.expense_id
      LEFT JOIN LATERAL (
        SELECT candidate.expense_id
        FROM evidence_records AS candidate
        JOIN expenses AS candidate_expense ON candidate_expense.id = candidate.expense_id
        WHERE candidate.file_sha256 = evidence.file_sha256
          AND candidate_expense.fund_id = parent_fund.fund_id
          AND candidate.expense_id <> evidence.expense_id
        ORDER BY candidate.created_at, candidate.evidence_id
        LIMIT 1
      ) AS duplicate ON true
      WHERE parent_fund.fund_id = ${fundId} AND evidence.expense_id = ${expenseId}
      ORDER BY evidence.created_at, evidence.evidence_id
    `;
    return rows.map(toStoredEvidence);
  }

  async findBySha256(fundId: string, sha256: string): Promise<readonly StoredEvidence[]> {
    const rows = await this.sql<EvidenceRow[]>`
      SELECT evidence.evidence_id, evidence.expense_id, parent_fund.fund_id AS fund_id,
        evidence.file_sha256, evidence.file_size_bytes, evidence.content_type,
        evidence.file_name, evidence.storage_key, evidence.scan_result,
        evidence.scanner_name, evidence.signature_version, evidence.vendor_name,
        evidence.gstin, evidence.invoice_number, evidence.invoice_date,
        evidence.created_at, duplicate.expense_id AS duplicate_expense_id
      FROM evidence_records AS evidence
      JOIN expenses AS parent_fund ON parent_fund.id = evidence.expense_id
      LEFT JOIN LATERAL (
        SELECT candidate.expense_id
        FROM evidence_records AS candidate
        JOIN expenses AS candidate_expense ON candidate_expense.id = candidate.expense_id
        WHERE candidate.file_sha256 = evidence.file_sha256
          AND candidate_expense.fund_id = parent_fund.fund_id
          AND candidate.expense_id <> evidence.expense_id
        ORDER BY candidate.created_at, candidate.evidence_id
        LIMIT 1
      ) AS duplicate ON true
      WHERE parent_fund.fund_id = ${fundId} AND evidence.file_sha256 = ${sha256}
      ORDER BY evidence.created_at, evidence.evidence_id
    `;
    return rows.map(toStoredEvidence);
  }

  async scanPage(
    afterEvidenceId: string | undefined,
    limit: number,
    fundId?: string,
  ): Promise<readonly StoredEvidence[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError("Evidence page size must be between 1 and 1000");
    }
    const rows = await this.sql<EvidenceRow[]>`
      SELECT evidence.evidence_id, evidence.expense_id, parent_fund.fund_id AS fund_id,
        evidence.file_sha256, evidence.file_size_bytes, evidence.content_type,
        evidence.file_name, evidence.storage_key, evidence.scan_result,
        evidence.scanner_name, evidence.signature_version, evidence.vendor_name,
        evidence.gstin, evidence.invoice_number, evidence.invoice_date,
        evidence.created_at, duplicate.expense_id AS duplicate_expense_id
      FROM evidence_records AS evidence
      JOIN expenses AS parent_fund ON parent_fund.id = evidence.expense_id
      LEFT JOIN LATERAL (
        SELECT candidate.expense_id
        FROM evidence_records AS candidate
        JOIN expenses AS candidate_expense ON candidate_expense.id = candidate.expense_id
        WHERE candidate.file_sha256 = evidence.file_sha256
          AND candidate_expense.fund_id = parent_fund.fund_id
          AND candidate.expense_id <> evidence.expense_id
        ORDER BY candidate.created_at, candidate.evidence_id
        LIMIT 1
      ) AS duplicate ON true
      WHERE evidence.evidence_id > ${afterEvidenceId ?? "00000000-0000-0000-0000-000000000000"}
        AND (${fundId ?? null}::uuid IS NULL OR parent_fund.fund_id = ${fundId ?? null})
      ORDER BY evidence.evidence_id
      LIMIT ${limit}
    `;
    return rows.map(toStoredEvidence);
  }
}
