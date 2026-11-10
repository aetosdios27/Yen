import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Route fixtures for the five core journeys documented in
 * docs/ux/five-core-journeys.md. Every route pattern must correspond to a
 * page.tsx under apps/web/src/app, so the test cannot drift from the real
 * app router.
 */
const APP_DIR = resolve(import.meta.dirname, "..", "app");

/** Hoisted so the vi.mock factories below can reference them. */
const { FUND_ID, EXPENSE_ID, RECEIPT_ID } = vi.hoisted(() => ({
  FUND_ID: "00000000-0000-4000-8000-0000000000f1",
  EXPENSE_ID: "00000000-0000-4000-8000-0000000000e1",
  RECEIPT_ID: "00000000-0000-4000-8000-00000000000001",
}));

interface JourneyRoute {
  readonly journey: number;
  readonly route: string;
  readonly pageFile: string;
}

const CORE_JOURNEY_ROUTES: readonly JourneyRoute[] = [
  { journey: 1, route: "/onboarding", pageFile: "onboarding/page.tsx" },
  { journey: 1, route: "/invites/accept", pageFile: "invites/accept/page.tsx" },
  { journey: 2, route: "/funds/[fundId]", pageFile: "funds/[fundId]/page.tsx" },
  { journey: 2, route: "/funds/[fundId]/donate", pageFile: "funds/[fundId]/donate/page.tsx" },
  { journey: 2, route: "/receipts/[id]", pageFile: "receipts/[id]/page.tsx" },
  { journey: 2, route: "/verify", pageFile: "verify/page.tsx" },
  { journey: 3, route: "/funds/[fundId]/treasurer", pageFile: "funds/[fundId]/treasurer/page.tsx" },
  {
    journey: 3,
    route: "/funds/[fundId]/dashboard",
    pageFile: "funds/[fundId]/dashboard/page.tsx",
  },
  {
    journey: 3,
    route: "/funds/[fundId]/expenses/new",
    pageFile: "funds/[fundId]/expenses/new/page.tsx",
  },
  {
    journey: 4,
    route: "/funds/[fundId]/approvals/[expenseId]",
    pageFile: "funds/[fundId]/approvals/[expenseId]/page.tsx",
  },
  { journey: 5, route: "/", pageFile: "page.tsx" },
];

/** Routes that journeys link to from deeper screens but do not own. */
const SUPPORTING_ROUTES: readonly JourneyRoute[] = [
  { journey: 5, route: "/privacy", pageFile: "privacy/page.tsx" },
  { journey: 5, route: "/terms", pageFile: "terms/page.tsx" },
];

/** All page.tsx files under src/app, as route patterns, derived from disk. */
function collectAppRoutePatterns(): string[] {
  const patterns: string[] = [];

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
      const relative = dir.slice(APP_DIR.length).replaceAll("\\", "/");
      patterns.push(relative === "" ? "/" : relative);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      }
    }
  };

  walk(APP_DIR);
  return patterns.sort();
}

/** Matches a concrete pathname against a route pattern like /funds/[fundId]/donate. */
function matchesRoutePattern(pathname: string, pattern: string): boolean {
  const pathSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  if (pathSegments.length !== patternSegments.length) {
    return false;
  }
  return patternSegments.every((segment, index) => {
    const actual = pathSegments[index];
    if (actual === undefined) {
      return false;
    }
    return segment.startsWith("[") ? actual.length > 0 : segment === actual;
  });
}

describe("core journey route fixtures", () => {
  it("maps every core journey route to an existing page.tsx in the app router", () => {
    for (const { journey, route, pageFile } of [...CORE_JOURNEY_ROUTES, ...SUPPORTING_ROUTES]) {
      expect(existsSync(join(APP_DIR, pageFile)), `journey ${journey} route ${route}`).toBe(true);
    }
  });

  it("derives every core journey route pattern from the real router directory", () => {
    const diskPatterns = collectAppRoutePatterns();
    for (const { route } of CORE_JOURNEY_ROUTES) {
      expect(diskPatterns, `route ${route} exists on disk`).toContain(route);
    }
  });

  it("resolves concrete journey URLs against the derived route patterns", () => {
    const patterns = collectAppRoutePatterns();

    const journeyUrls = [
      "/onboarding",
      "/invites/accept?code=abc123",
      `/funds/${FUND_ID}`,
      `/funds/${FUND_ID}/donate`,
      `/receipts/${RECEIPT_ID}`,
      "/verify?fundId=00000000-0000-4000-8000-0000000000f1&recordId=00000000-0000-4000-8000-00000000000020",
      `/funds/${FUND_ID}/treasurer`,
      `/funds/${FUND_ID}/dashboard`,
      `/funds/${FUND_ID}/expenses/new`,
      `/funds/${FUND_ID}/approvals/${EXPENSE_ID}`,
      "/",
      "/privacy",
      "/terms",
    ];

    for (const url of journeyUrls) {
      const [pathname] = url.split("?");
      expect(
        patterns.some((pattern) => matchesRoutePattern(pathname ?? "", pattern)),
        `url ${url} resolves to an app route`,
      ).toBe(true);
    }
  });
});

/**
 * Data layer mocks. The pages under test are the real page components; only
 * their API/data dependencies are stubbed, following the conventions of
 * receipt-page.test.tsx and verify.a11y.test.tsx.
 */
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  useParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({
    back: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => searchParams.current,
}));

vi.mock("../lib/expense-service", async () => {
  const { paise } = await import("@yen/shared");
  const treasurerData = {
    fundId: FUND_ID,
    fundName: "RoboCup 2026 Asia Fund",
    totalBalancePaise: paise(25000000),
    spendableBalancePaise: paise(17500000),
    pendingExpenses: [
      {
        id: EXPENSE_ID,
        fundId: FUND_ID,
        amountPaise: paise(250000),
        payeeName: "Ramesh Electricals",
        payeeUpi: "ramesh@yenbank",
        purpose: "Stage audio monitors",
        status: "submitted",
        requesterId: "user-1",
        requesterName: "Treasurer Tara",
        createdAt: "2026-10-25T09:00:00Z",
        approvals: [],
        requiredQuorum: 2,
      },
    ],
  };
  return {
    createExpenseRequest: vi.fn(async () => undefined),
    fetchExpenseItem: vi.fn(async () => treasurerData.pendingExpenses[0]),
    fetchFundTreasurerData: vi.fn(async () => treasurerData),
    submitExpenseApproval: vi.fn(async () => treasurerData.pendingExpenses[0]),
    submitExpenseRejection: vi.fn(async () => treasurerData.pendingExpenses[0]),
  };
});

vi.mock("../components/fund/data", async () => {
  const { paise } = await import("@yen/shared");
  const publicFund = {
    id: FUND_ID,
    name: "RoboCup 2026 Asia Fund",
    purpose: "Send the team to the regional championship",
    org: { id: "org-1", name: "Robotics Club", verification: "anchored" },
    money: {
      totalRaised: paise(25000000),
      totalSpent: paise(7500000),
      currentBalance: paise(17500000),
    },
    spendingBreakdown: [{ id: "equipment", amount: paise(7500000), percentage: 100 }],
    timeline: [
      {
        id: "00000000-0000-4000-8000-00000000000020",
        type: "expense",
        title: "Stage audio monitors",
        description: "Paid to Ramesh Electricals",
        amount: paise(250000),
        dateTime: "2026-10-25T10:30:00Z",
        category: "equipment",
        status: "verified",
      },
    ],
    upiPayee: { vpa: "robotics@yenbank", payeeName: "Robotics Club" },
  };
  return { getPublicFund: vi.fn(async () => publicFund) };
});

vi.mock("../env", () => ({ env: { NEXT_PUBLIC_API_URL: "http://api.test" } }));

import { act, render, screen, waitFor } from "@testing-library/react";
import { createElement, Suspense } from "react";
import { beforeEach } from "vitest";
import ApproverPage from "../app/funds/[fundId]/approvals/[expenseId]/page";
import DonatePage from "../app/funds/[fundId]/donate/page";
import NewExpensePage from "../app/funds/[fundId]/expenses/new/page";
import FundPage from "../app/funds/[fundId]/page";
import TreasurerPage from "../app/funds/[fundId]/treasurer/page";
import InviteAcceptPage from "../app/invites/accept/page";
import OnboardingPage from "../app/onboarding/page";
import ReceiptPage from "../app/receipts/[id]/page";
import VerifyPage from "../app/verify/page";
import { LocaleProvider } from "../i18n";

beforeEach(() => {
  searchParams.current = new URLSearchParams();
});

/**
 * Renders a journey screen inside the landmarks the app shell provides.
 * The Suspense boundary mirrors the streaming shell around server pages, and
 * the async act flushes pages that suspend on their params promise.
 */
async function renderJourneyScreen(ui: React.ReactElement) {
  return act(() =>
    render(
      createElement(
        LocaleProvider,
        null,
        createElement("main", null, createElement(Suspense, { fallback: null }, ui)),
      ),
    ),
  );
}

describe("journey 1: create fund and nominate co-approvers", () => {
  it("renders the onboarding wizard with its form and the setup heading", async () => {
    const { container } = await renderJourneyScreen(createElement(OnboardingPage));

    expect(screen.getByRole("heading", { level: 1, name: "Set up your club fund" })).toBeDefined();
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined();
  });

  it("renders the co-approver invite acceptance form for a valid invite link", async () => {
    searchParams.current = new URLSearchParams({ code: "invite-code" });
    const { container } = await renderJourneyScreen(createElement(InviteAcceptPage));

    expect(screen.getByRole("heading", { level: 1, name: "Join as an approver" })).toBeDefined();
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Accept invite" })).toBeDefined();
  });

  it("renders the empty state for an invite link without a code", async () => {
    await renderJourneyScreen(createElement(InviteAcceptPage));

    expect(screen.getByText("This invite link is incomplete.")).toBeDefined();
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("journey 2: donate via upi and verify receipt", () => {
  it("renders the public fund page with the donate entry point", async () => {
    const ui = await FundPage({ params: Promise.resolve({ fundId: FUND_ID }) });
    const { container } = await renderJourneyScreen(ui);

    expect(screen.getByRole("heading", { level: 1, name: "RoboCup 2026 Asia Fund" })).toBeDefined();
    expect(screen.getByRole("article")).toBeDefined();
    expect(screen.getByRole("link", { name: "Donate via UPI" })).toBeDefined();
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders the donation form for the fund", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fundId: FUND_ID,
        title: "RoboCup 2026 Asia Fund",
        upiVpa: "robotics@yenbank",
        upiPayeeName: "Robotics Club",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const ui = await DonatePage({ params: Promise.resolve({ fundId: FUND_ID }) });
      const { container } = await renderJourneyScreen(ui);

      expect(
        screen.getByRole("heading", { level: 1, name: "Give to RoboCup 2026 Asia Fund" }),
      ).toBeDefined();
      expect(container.querySelector("form")).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders the receipt certificate with its verification link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        donationId: RECEIPT_ID,
        fundId: FUND_ID,
        fundName: "RoboCup 2026 Asia Fund",
        amountPaise: "500000",
        status: "verified",
        utr: "123456789012",
        createdAt: "2026-10-25T10:30:00Z",
        donorDisplayName: "Priya Sharma",
        disclaimerEn: "This contribution is not eligible for tax deductions.",
        disclaimerHi: "यह अंशदान कर कटौती के लिए पात्र नहीं है।",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const ui = await ReceiptPage({ params: Promise.resolve({ id: RECEIPT_ID }) });
      renderJourneyScreen(ui);

      expect(
        screen.getByRole("heading", { level: 1, name: "Verified Donation Certificate" }),
      ).toBeDefined();
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeDefined();
      expect(screen.getByRole("link", { name: /Check live verification record/ })).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders the verification page with its check form", async () => {
    const { container } = await renderJourneyScreen(createElement(VerifyPage));

    expect(screen.getByRole("heading", { level: 1, name: "Verify a record" })).toBeDefined();
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Check record" })).toBeDefined();
  });
});

describe("journey 3: treasurer files an expense request", () => {
  it("renders the treasurer dashboard with balances, the pending list and the new expense action", async () => {
    renderJourneyScreen(
      createElement(TreasurerPage, { params: Promise.resolve({ fundId: FUND_ID }) }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Treasurer dashboard" }),
    ).toBeDefined();
    await waitFor(() => expect(screen.getByText("Total balance")).toBeDefined());
    expect(screen.getByText("Spendable balance")).toBeDefined();
    expect(screen.getByText("Pending expenses")).toBeDefined();
    expect(screen.getByRole("link", { name: "New Expense" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Review" })).toBeDefined();
  });

  it("renders the new expense form", async () => {
    const { container } = await renderJourneyScreen(
      createElement(NewExpensePage, { params: Promise.resolve({ fundId: FUND_ID }) }),
    );

    await waitFor(() => expect(container.querySelector("form")).not.toBeNull());
    expect(screen.getByRole("heading", { name: "New expense request" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Review expense" })).toBeDefined();
  });
});

describe("journey 4: co-approver reviews and authorizes", () => {
  it("renders the approval request with both decision actions", async () => {
    renderJourneyScreen(
      createElement(ApproverPage, {
        params: Promise.resolve({ fundId: FUND_ID, expenseId: EXPENSE_ID }),
      }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Expense approval request" }),
    ).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeDefined();
    expect(screen.getByText("Ramesh Electricals")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
  });
});
