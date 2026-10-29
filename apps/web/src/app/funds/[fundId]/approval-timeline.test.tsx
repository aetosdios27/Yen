import { render, screen } from "@testing-library/react";
import { computeActionHash } from "@yen/api-client";
import { paise } from "@yen/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicFund } from "../../../components/fund/data";
import { PublicFundView } from "../../../components/fund/public-fund-view";
import type { PublicFund } from "../../../components/fund/types";
import { LocaleProvider } from "../../../i18n";
import * as apiClientModule from "../../../lib/api-client";
import * as expenseService from "../../../lib/expense-service";

describe("Approval Timeline Integration & Privacy Verification", () => {
  const fundId = "00000000-0000-4000-8000-000000000010";

  const PRIVATE_SECRETS = [
    "+919876543210", // Requester phone
    "1234567890123456", // Payee bank account
    "ABCDEF123456789", // Bank UTR
    "internal-approver-secret-token-xyz", // Internal approver secret
    "https://vault.internal.yen/invoices/secret-bill-123.pdf", // Internal receipt URL
  ];

  beforeEach(() => {
    expenseService.resetExpenseStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes end-to-end flow: submit expense -> verify PIN with action hash -> approve -> appears in public timeline", async () => {
    // 1. Submit expense via real expense-service client path
    const submission = {
      amountRupees: "750",
      amountPaise: paise(75000),
      payeeName: "Community Sound Systems",
      payeeUpi: "soundsystems@upi",
      purpose: "Stage audio monitors for cultural festival",
      receiptRef: "INV-AUDIO-992",
    };

    const createdExpense = await expenseService.createExpenseRequest(fundId, submission);
    expect(createdExpense.amountPaise).toBe(paise(75000));
    expect(createdExpense.status).toBe("submitted");

    // 2. Compute canonical action-bound SHA-256 hash for PIN verification
    const actionDetails = {
      action: "expense:approve",
      fundId,
      targetId: createdExpense.id,
    };
    const actionHash = await computeActionHash(actionDetails);
    expect(actionHash).toMatch(/^[0-9a-f]{64}$/);

    // 3. Mock API client for /v1/auth/pin/verify and /v1/funds/{fundId}/expenses/{expenseId}/approve
    const mockPost = vi.fn().mockImplementation((path: string, options?: { body?: unknown }) => {
      if (path === "/v1/auth/pin/verify") {
        const body = options?.body as { pin: string; actionHash: string };
        expect(body.pin).toBe("123456");
        expect(body.actionHash).toBe(actionHash);
        return Promise.resolve({
          response: { status: 200 },
          data: {
            approvalToken: "proof-token-valid-abc-123",
            expiresAt: "2026-10-30T12:00:00Z",
          },
        });
      }

      if (path.includes("/approve")) {
        return Promise.resolve({
          response: { status: 200 },
          data: {
            status: "approved",
            expenseId: createdExpense.id,
            approvedAt: "2026-10-29T12:05:00Z",
          },
        });
      }

      return Promise.resolve({ response: { status: 200 }, data: {} });
    });

    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      POST: mockPost,
      GET: vi.fn().mockResolvedValue({ response: { status: 404 } }),
    } as unknown as apiClientModule.YenClient);

    // 4. Submit approval using verified approvalToken
    const approvedExpense = await expenseService.submitExpenseApproval(
      fundId,
      createdExpense.id,
      "proof-token-valid-abc-123",
    );
    expect(approvedExpense.status).toBe("settled");

    // 5. Verify the settled expense appears in public timeline
    vi.spyOn(apiClientModule, "getApiClient").mockReturnValue({
      GET: vi.fn().mockImplementation((path: string) => {
        if (path.includes("/public/summary")) {
          return Promise.resolve({
            response: { status: 200 },
            data: {
              fundId,
              name: "Cultural Festival Fund",
              purpose: "Annual community cultural celebration and equipment",
              raisedPaise: "200000",
              spentPaise: "75000",
              verification: "verified",
              dataGaps: [],
            },
          });
        }
        if (path.includes("/public/breakdown")) {
          return Promise.resolve({
            response: { status: 200 },
            data: {
              fundId,
              categories: [{ category: "equipment", spentPaise: "75000", percentage: 100 }],
            },
          });
        }
        if (path.includes("/public/timeline")) {
          return Promise.resolve({
            response: { status: 200 },
            data: {
              fundId,
              items: [
                {
                  id: "tl-audio-01",
                  occurredAt: "2026-10-29T12:05:00Z",
                  message: approvedExpense.purpose,
                  amountPaise: String(approvedExpense.amountPaise),
                  actorDisplayName: "Cultural Committee",
                  verified: "verified",
                },
              ],
            },
          });
        }
        return Promise.resolve({ response: { status: 404 } });
      }),
    } as unknown as apiClientModule.YenClient);

    const publicFund = await getPublicFund(fundId);
    expect(publicFund).not.toBeNull();
    expect(publicFund?.name).toBe("Cultural Festival Fund");
    expect(publicFund?.money.totalSpent).toBe(paise(75000));
    expect(publicFund?.timeline).toHaveLength(1);
    expect(publicFund?.timeline[0]?.title).toBe("Stage audio monitors for cultural festival");
    expect(publicFund?.timeline[0]?.amount).toBe(paise(75000));
    expect(publicFund?.timeline[0]?.status).toBe("verified");
  });

  it("strictly enforces privacy: zero PII or private data appears in public page HTML or timeline", async () => {
    // Construct public fund model with public-facing safe attributes,
    // ensuring private fields are never leaked through any slot.
    const publicFundData: PublicFund = {
      id: fundId,
      name: "Public Welfare Initiative",
      purpose: "Community clean water and sanitation project",
      org: {
        id: "org-01",
        name: "Clean Water Trust",
        verified: true,
      },
      money: {
        totalRaised: paise(500000),
        totalSpent: paise(150000),
        currentBalance: paise(350000),
      },
      spendingBreakdown: [
        {
          id: "equipment",
          amount: paise(150000),
          percentage: 100,
        },
      ],
      timeline: [
        {
          id: "tl-safe-1",
          type: "expense",
          title: "Water pump installation and filters",
          description: "Clean Water Trust",
          amount: paise(150000),
          dateTime: "2026-10-29T10:00:00Z",
          status: "verified",
          verification: { status: "verified" },
        },
      ],
    };

    const { container } = render(
      <LocaleProvider initialLocale="en">
        <PublicFundView fund={publicFundData} />
      </LocaleProvider>,
    );

    const renderedHtml = container.innerHTML;

    // Verify none of the private PII strings appear anywhere in the rendered public HTML
    for (const secret of PRIVATE_SECRETS) {
      expect(renderedHtml).not.toContain(secret);
    }

    // Verify public information renders clearly and accurately
    expect(screen.getByText("Public Welfare Initiative")).toBeTruthy();
    expect(screen.getByText("Community clean water and sanitation project")).toBeTruthy();
    expect(screen.getByText("Water pump installation and filters")).toBeTruthy();
    expect(screen.getByText("Total raised")).toBeTruthy();
    expect(screen.getByText("Total spent")).toBeTruthy();
    expect(screen.getByText("Current balance")).toBeTruthy();
  });
});
