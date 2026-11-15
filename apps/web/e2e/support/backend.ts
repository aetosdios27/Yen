import { createHash } from "node:crypto";

export const isRealBackend = process.env.E2E_BACKEND === "real";

export const webPort = Number(process.env.E2E_WEB_PORT ?? 3137);
export const apiPort = Number(process.env.E2E_API_PORT ?? 3939);
export const proxyPort = Number(process.env.E2E_PROXY_PORT ?? 3940);

/**
 * The API base the browser talks to: the stub API in mock mode, the CORS edge
 * in front of the real API in real mode. directApiBase is what node-side
 * requests use, where browser CORS rules never apply.
 */
export const browserApiBase = isRealBackend
  ? `http://localhost:${proxyPort}`
  : `http://127.0.0.1:${apiPort}`;
export const directApiBase = `http://127.0.0.1:${apiPort}`;

export const mockFundId = "00000000-0000-4000-8000-0000000000f1";
export const seedFundId = "01940000-0000-7000-8000-000000000002";
export const fundId = isRealBackend ? seedFundId : mockFundId;

export const seedSessions = {
  treasurer: "yen_mock_session_treasurer_token",
  approver1: "yen_mock_session_approver1_token",
  approver2: "yen_mock_session_approver2_token",
  donor1: "yen_mock_session_donor1_token",
} as const;

export const e2ePin = "482613";

export function uniqueUtr(): string {
  return `${(Date.now() % 900_000_000_000) + 100_000_000_000}`;
}

export function expenseApprovalActionHash(fundIdValue: string, expenseIdValue: string): string {
  const details = { action: "expense:approve", fundId: fundIdValue, targetId: expenseIdValue };
  const canonical = Object.keys(details)
    .sort()
    .map((key) => [key, details[key as keyof typeof details]] as const);
  return createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(canonical)))
    .digest("hex");
}
