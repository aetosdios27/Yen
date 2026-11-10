import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  browserApiBase,
  directApiBase,
  e2ePin,
  expenseApprovalActionHash,
  isRealBackend,
  seedFundId,
  seedSessions,
  uniqueUtr,
} from "./support/backend";
import {
  enableVirtualAuthenticator,
  removeVirtualAuthenticator,
} from "./support/virtual-authenticator";

test.skip(!isRealBackend, "runs only with E2E_BACKEND=real against a Postgres-backed API");

test.describe.configure({ mode: "serial" });

const fundUrl = `/funds/${seedFundId}`;
const apiHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

async function addSessionCookie(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    {
      name: "yen_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function setupPin(token: string): Promise<void> {
  const response = await fetch(`${directApiBase}/v1/auth/pin/setup`, {
    method: "POST",
    headers: { ...apiHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ pin: e2ePin }),
  });
  expect(response.status).toBe(200);
}

interface RegistrationResult {
  readonly credentialId: string;
  readonly error?: string;
}

interface AssertionResult {
  readonly deviceProof?: string;
  readonly error?: string;
}

const registerPasskeyInPage = async (args: {
  apiBase: string;
  pin: string;
}): Promise<RegistrationResult> => {
  const decodeBase64url = (value: string): ArrayBuffer => {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
      .buffer as ArrayBuffer;
  };
  const encodeBase64url = (bytes: ArrayBuffer): string => {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  };
  try {
    const optionsResponse = await fetch(
      `${args.apiBase}/v1/auth/device-credentials/registration/options`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    if (!optionsResponse.ok)
      return { credentialId: "", error: `options failed: ${optionsResponse.status}` };
    const options = (await optionsResponse.json()) as {
      challenge: string;
      rp: { id?: string; name: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: { type: "public-key"; alg: number }[];
      authenticatorSelection?: Record<string, unknown>;
      excludeCredentials?: { id: string; type: "public-key" }[];
    };

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: decodeBase64url(options.challenge),
        rp: options.rp,
        user: {
          id: decodeBase64url(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName,
        },
        pubKeyCredParams: options.pubKeyCredParams,
        ...(options.authenticatorSelection
          ? {
              authenticatorSelection:
                options.authenticatorSelection as AuthenticatorSelectionCriteria,
            }
          : {}),
        ...(options.excludeCredentials
          ? {
              excludeCredentials: options.excludeCredentials.map((descriptor) => ({
                id: decodeBase64url(descriptor.id),
                type: descriptor.type,
              })),
            }
          : {}),
      },
    })) as PublicKeyCredential | null;
    if (!credential) return { credentialId: "", error: "no credential returned" };
    const attestation = credential.response as AuthenticatorAttestationResponse;

    const verifyResponse = await fetch(
      `${args.apiBase}/v1/auth/device-credentials/registration/verify`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "e2e virtual authenticator",
          pin: args.pin,
          response: {
            id: credential.id,
            rawId: encodeBase64url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: encodeBase64url(attestation.clientDataJSON),
              attestationObject: encodeBase64url(attestation.attestationObject),
              transports: attestation.getTransports?.() ?? [],
            },
          },
        }),
      },
    );
    if (!verifyResponse.ok) {
      return {
        credentialId: "",
        error: `verify failed: ${verifyResponse.status} ${await verifyResponse.text()}`,
      };
    }
    const verified = (await verifyResponse.json()) as { credentialId?: string };
    return { credentialId: verified.credentialId ?? credential.id };
  } catch (error) {
    return { credentialId: "", error: error instanceof Error ? error.message : String(error) };
  }
};

const signApprovalInPage = async (args: {
  apiBase: string;
  actionHash: string;
}): Promise<AssertionResult> => {
  const decodeBase64url = (value: string): ArrayBuffer => {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
      .buffer as ArrayBuffer;
  };
  const encodeBase64url = (bytes: ArrayBuffer): string => {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  };
  try {
    const optionsResponse = await fetch(`${args.apiBase}/v1/auth/device-signatures/options`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionHash: args.actionHash }),
    });
    if (!optionsResponse.ok) return { error: `options failed: ${optionsResponse.status}` };
    const options = (await optionsResponse.json()) as {
      challenge: string;
      rpId?: string;
      allowCredentials?: { id: string; type: "public-key" }[];
      userVerification?: string;
    };

    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: decodeBase64url(options.challenge),
        ...(options.rpId ? { rpId: options.rpId } : {}),
        ...(options.allowCredentials
          ? {
              allowCredentials: options.allowCredentials.map((descriptor) => ({
                id: decodeBase64url(descriptor.id),
                type: descriptor.type,
              })),
            }
          : {}),
        ...(options.userVerification
          ? { userVerification: options.userVerification as UserVerificationRequirement }
          : {}),
      },
    })) as PublicKeyCredential | null;
    if (!credential) return { error: "no assertion returned" };
    const assertion = credential.response as AuthenticatorAssertionResponse;

    const verifyResponse = await fetch(`${args.apiBase}/v1/auth/device-signatures/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionHash: args.actionHash,
        response: {
          id: credential.id,
          rawId: encodeBase64url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: encodeBase64url(assertion.clientDataJSON),
            authenticatorData: encodeBase64url(assertion.authenticatorData),
            signature: encodeBase64url(assertion.signature),
            ...(assertion.userHandle ? { userHandle: encodeBase64url(assertion.userHandle) } : {}),
          },
        },
      }),
    });
    if (!verifyResponse.ok) {
      return { error: `verify failed: ${verifyResponse.status} ${await verifyResponse.text()}` };
    }
    return (await verifyResponse.json()) as { deviceProof: string };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

test.describe("real backend journey", () => {
  const utr = uniqueUtr();
  let expenseId = "";

  test("a donor records a UPI donation on the public fund page", async ({ page }) => {
    await page.goto(fundUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("RoboCup 2026 Asia Fund");

    await page.goto(`${fundUrl}/donate`);
    await page.getByRole("button", { name: "₹500", exact: true }).click();
    await page.getByLabel("12-digit UPI reference").fill(utr);
    await page.getByRole("button", { name: "Record my donation" }).click();
    await expect(page.getByText("Donation recorded, waiting for the bank")).toBeVisible();
  });

  test("the treasurer files an expense request and uploads the bill", async ({ page }) => {
    await addSessionCookie(page, seedSessions.treasurer);
    await page.goto(`${fundUrl}/expenses/new`);

    await page.getByLabel("Amount (₹)").fill("2500");
    await page.getByLabel("Payee name").fill("Ramesh Electricals");
    await page.getByLabel("Payee UPI VPA").fill("ramesh@yenbank");
    await page.getByLabel("Purpose").fill("Community hall light fixtures");
    await page.getByRole("button", { name: "Review expense" }).click();
    await page.getByRole("button", { name: "Submit expense" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Treasurer dashboard");

    const listResponse = await page.request.get(
      `${directApiBase}/v1/funds/${seedFundId}/expenses`,
      {
        headers: apiHeaders(seedSessions.treasurer),
      },
    );
    expect(listResponse.ok()).toBeTruthy();
    const expenses = (await listResponse.json()) as Array<{
      id: string;
      description: string;
      status: string;
    }>;
    const created = expenses.find(
      (candidate) => candidate.description === "Community hall light fixtures",
    );
    expect(created, "created expense should be listed").toBeTruthy();
    if (!created) throw new Error("created expense should be listed");
    expect(created.status).toBe("submitted");
    expenseId = created.id;

    const bill = await readFile(new URL("./support/fixtures/bill.png", import.meta.url));
    const upload = await page.request.post(
      `${directApiBase}/v1/funds/${seedFundId}/expenses/${expenseId}/evidence`,
      {
        headers: apiHeaders(seedSessions.treasurer),
        multipart: {
          file: { name: "bill.png", mimeType: "image/png", buffer: bill },
          vendorName: "Ramesh Electricals",
          invoiceNumber: "INV-1042",
        },
      },
    );
    expect(upload.status()).toBe(201);
    const evidence = (await upload.json()) as { fileSha256: string; scan: { result: string } };
    expect(evidence.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.scan.result).toBe("clean");
  });

  test("an approver registers a passkey on a virtual authenticator", async ({ page }) => {
    await setupPin(seedSessions.approver1);
    await addSessionCookie(page, seedSessions.approver1);
    await page.goto(fundUrl);

    const authenticator = await enableVirtualAuthenticator(page);
    try {
      const result = await page.evaluate(registerPasskeyInPage, {
        apiBase: browserApiBase,
        pin: e2ePin,
      });
      expect(result.error ?? "registration failed", result.error).toBeUndefined();
      expect(result.credentialId).not.toBe("");
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }

    const credentials = await page.request.get(`${directApiBase}/v1/auth/device-credentials`, {
      headers: apiHeaders(seedSessions.approver1),
    });
    expect(credentials.status()).toBe(200);
    const list = (await credentials.json()) as {
      credentials: Array<{ label: string; revokedAt: string | null }>;
    };
    expect(
      list.credentials.some((credential) => credential.label === "e2e virtual authenticator"),
    ).toBe(true);
  });

  test("the passkey signs the approval and the quorum releases the expense", async ({ page }) => {
    const actionHashHex = expenseApprovalActionHash(seedFundId, expenseId);

    await addSessionCookie(page, seedSessions.approver1);
    await page.goto(fundUrl);
    const authenticator = await enableVirtualAuthenticator(page);
    let deviceProof = "";
    try {
      const signed = await page.evaluate(signApprovalInPage, {
        apiBase: browserApiBase,
        actionHash: actionHashHex,
      });
      expect(signed.error ?? "assertion failed", signed.error).toBeUndefined();
      deviceProof = signed.deviceProof ?? "";
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
    expect(deviceProof).not.toBe("");

    const approval = await page.request.post(
      `${directApiBase}/v1/funds/${seedFundId}/expenses/${expenseId}/approve`,
      {
        headers: { ...apiHeaders(seedSessions.approver1), "idempotency-key": randomUUID() },
        data: { pin: e2ePin, deviceProof },
      },
    );
    expect(approval.status()).toBe(200);
    expect(((await approval.json()) as { approvalsCount: number }).approvalsCount).toBe(1);

    await setupPin(seedSessions.approver2);
    await addSessionCookie(page, seedSessions.approver2);
    await page.goto(`${fundUrl}/approvals/${expenseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Expense approval request");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const pinDialog = page.getByRole("dialog");
    await pinDialog.getByLabel("Approval PIN").fill(e2ePin);
    await pinDialog.getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText(/approved/i).first()).toBeVisible();
  });

  test("the treasurer pays and reconciles the expense against the bank", async ({ request }) => {
    await setupPin(seedSessions.treasurer);
    const bankTransactionId = randomUUID();

    const paid = await request.post(
      `${directApiBase}/v1/funds/${seedFundId}/expenses/${expenseId}/pay`,
      {
        headers: { ...apiHeaders(seedSessions.treasurer), "idempotency-key": randomUUID() },
        data: { pin: e2ePin, bankTransactionId },
      },
    );
    expect(paid.status()).toBe(200);
    expect(((await paid.json()) as { status: string }).status).toBe("paid");

    const reconciled = await request.post(
      `${directApiBase}/v1/funds/${seedFundId}/expenses/${expenseId}/reconcile`,
      {
        headers: { ...apiHeaders(seedSessions.treasurer), "idempotency-key": randomUUID() },
        data: { bankTransactionId },
      },
    );
    expect(reconciled.status()).toBe(200);
    expect(((await reconciled.json()) as { status: string }).status).toBe("reconciled");
  });

  test("the bank statement matches the donation pledge", async ({ request }) => {
    const csv = [
      "Date,Narration,Ref No.,Deposit,Withdrawal",
      `01/11/2026,UPI/CR/${utr}/ANANYA/ICIC,${utr},500.00,`,
    ].join("\n");
    const response = await request.post(`${directApiBase}/v1/reconciliation/statements`, {
      headers: { ...apiHeaders(seedSessions.treasurer), "idempotency-key": randomUUID() },
      data: { fundId: seedFundId, csvContent: csv },
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()) as { matchedCount: number };
    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
  });

  test("the public verifier confirms the expense record in the Merkle log", async ({ page }) => {
    await page.goto(`/verify?recordId=${encodeURIComponent(expenseId)}&fundId=${seedFundId}`);
    await expect(
      page.getByText(/Sealed in event log|matches the public record|record was/i).first(),
    ).toBeVisible();
  });
});
