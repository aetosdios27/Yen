import { createHash } from "node:crypto";
import type { PseudonymId } from "@yen/eventlog";
import type { Paise } from "@yen/shared";
import type { ExpenseRequest, PasskeySignatureData, SignedApproval } from "./types.js";

export function computeExpenseApprovalChallenge(
  expenseId: string,
  fundId: string,
  amountPaise: Paise,
): string {
  const payload = JSON.stringify({
    amount_paise: amountPaise,
    expense_id: expenseId,
    fund_id: fundId,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifyPasskeyBinding(
  signatureData: PasskeySignatureData,
  expense: Pick<ExpenseRequest, "id" | "fundId" | "amountPaise">,
): boolean {
  if (!signatureData.credentialId || !signatureData.signatureHex || !signatureData.clientDataJson) {
    return false;
  }
  try {
    const clientData = JSON.parse(signatureData.clientDataJson) as Record<string, unknown>;
    const expectedChallenge = computeExpenseApprovalChallenge(
      expense.id,
      expense.fundId,
      expense.amountPaise,
    );
    if (clientData.challenge !== expectedChallenge) {
      return false;
    }
    if (clientData.type !== "webauthn.get") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createMockPasskeyApproval(
  approverId: PseudonymId,
  expense: Pick<ExpenseRequest, "id" | "fundId" | "amountPaise">,
  nowUtc: string,
  credentialId = `cred_${approverId.slice(0, 8)}`,
): SignedApproval {
  const challenge = computeExpenseApprovalChallenge(
    expense.id,
    expense.fundId,
    expense.amountPaise,
  );
  const clientDataJson = JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: "https://yen.org.in",
    crossOrigin: false,
  });
  const authenticatorDataHex = createHash("sha256")
    .update(`authData:${approverId}`, "utf8")
    .digest("hex");
  const signatureHex = createHash("sha256")
    .update(`${authenticatorDataHex}:${clientDataJson}`, "utf8")
    .digest("hex");

  return {
    approverId,
    passkeySignature: {
      credentialId,
      signatureHex,
      clientDataJson,
      authenticatorDataHex,
    },
    approvedAt: nowUtc,
  };
}
