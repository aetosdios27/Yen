import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Route fixtures for the five core journeys documented in
 * docs/ux/five-core-journeys.md. Every route pattern must correspond to a
 * page.tsx under apps/web/src/app, so the test cannot drift from the real
 * app router.
 */
const APP_DIR = resolve(import.meta.dirname, "..", "app");

const FUND_ID = "00000000-0000-4000-8000-0000000000f1";
const EXPENSE_ID = "00000000-0000-4000-8000-0000000000e1";
const RECEIPT_ID = "00000000-0000-4000-8000-00000000000001";

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
