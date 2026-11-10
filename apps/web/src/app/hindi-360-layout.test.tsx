import { render } from "@testing-library/react";
import { paise } from "@yen/shared";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPinModal } from "../components/approval-pin-modal";
import { DonationForm } from "../components/donation-form";
import { ExpenseTimeline } from "../components/expense-timeline";
import { SANITIZED_DEMO_FUND } from "../components/fund/fixtures";
import { PublicFundView } from "../components/fund/public-fund-view";
import { LocaleProvider } from "../i18n";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/verify",
}));

const { fetchFundTreasurerData } = vi.hoisted(() => ({
  fetchFundTreasurerData: vi.fn(),
}));

vi.mock("../lib/expense-service", () => ({
  fetchFundTreasurerData,
}));

const webRoot = path.resolve(import.meta.dirname, "..", "..");
const TOKENS_CSS = fs.readFileSync(path.join(webRoot, "src/styles/tokens.css"), "utf8");
const GLOBALS_CSS = fs.readFileSync(path.join(webRoot, "src/app/globals.css"), "utf8");

/** Devanagari block, so clip guards only fire on text that is actually Hindi. */
const DEVANAGARI = /[\u0900-\u097F]/;

const NARROWEST_PHONE_PX = 360;

/** Tailwind spacing scale: one unit is 0.25rem = 4px at the default root size. */
const SPACING_UNIT_PX = 4;
const TAP_TARGET_MIN_PX = 48;

interface Violation {
  readonly reason: string;
  readonly detail: string;
}

/** First px number inside bracket notation, e.g. w-[420px] or text-[11px]. */
function fixedPx(className: string, prefix: string): number | null {
  const match = new RegExp(`(?:^|\\s)${prefix}\\[(\\d+)px\\]`).exec(className);
  return match === null ? null : Number(match[1]);
}

/** First Tailwind spacing-scale number, e.g. w-96 -> 96 units. */
function scaleUnits(className: string, prefix: string): number | null {
  const match = new RegExp(`(?:^|\\s)${prefix}(\\d+)\\b`).exec(className);
  return match === null ? null : Number(match[1]);
}

/** Text owned by this element only, without text from descendants. */
function ownText(node: Element): string {
  let text = "";
  for (const child of node.childNodes) {
    if (child.nodeType === child.TEXT_NODE) {
      text += child.textContent ?? "";
    }
  }
  return text;
}

function anyText(node: Element): string {
  return node.textContent ?? "";
}

function layoutViolations(root: Element): Violation[] {
  const violations: Violation[] = [];

  for (const node of [root, ...root.querySelectorAll("*")]) {
    const className =
      typeof node.className === "string" ? node.className : node.getAttribute("class") ?? "";

    const fixedWidth = fixedPx(className, "w-") ?? fixedPx(className, "min-w-");
    if (fixedWidth !== null && fixedWidth > NARROWEST_PHONE_PX) {
      violations.push({ reason: "fixed width over 360px", detail: className });
    }
    const scaledWidth = scaleUnits(className, "w-") ?? scaleUnits(className, "min-w-");
    if (scaledWidth !== null && scaledWidth * SPACING_UNIT_PX > NARROWEST_PHONE_PX) {
      violations.push({ reason: "scaled width over 360px", detail: className });
    }
    const inlineWidth = node instanceof HTMLElement ? node.style.width : "";
    if (inlineWidth.endsWith("px") && Number.parseFloat(inlineWidth) > NARROWEST_PHONE_PX) {
      violations.push({ reason: "inline width over 360px", detail: inlineWidth });
    }

    if (DEVANAGARI.test(anyText(node))) {
      if (/\bwhitespace-nowrap\b/.test(className)) {
        violations.push({ reason: "Hindi text cannot wrap", detail: className });
      }
      if (/\btruncate\b/.test(className) && DEVANAGARI.test(ownText(node))) {
        violations.push({ reason: "Hindi text is ellipsized", detail: className });
      }
    }

    if (anyText(node).trim() !== "") {
      const fixedText = fixedPx(className, "text-");
      if (fixedText !== null) {
        violations.push({ reason: "fixed px text ignores 200% zoom", detail: className });
      }
      const fixedHeight = fixedPx(className, "h-") ?? fixedPx(className, "max-h-");
      if (fixedHeight !== null) {
        violations.push({ reason: "fixed px height can clip text at 200% zoom", detail: className });
      }
    }
  }

  return violations;
}

function tapTargetViolations(root: Element): Violation[] {
  const violations: Violation[] = [];
  for (const node of root.querySelectorAll("button, a")) {
    const className =
      typeof node.className === "string" ? node.className : node.getAttribute("class") ?? "";
    // bg-primary/bg-danger without a suffix is the primary and danger action styling.
    const isPrimaryAction = /\b(?:bg-primary|bg-danger)(?![-\w])/.test(className);
    if (!isPrimaryAction || /\btap-target\b/.test(className)) {
      continue;
    }
    const minUnits = scaleUnits(className, "min-h-") ?? scaleUnits(className, "h-");
    if (minUnits === null || minUnits * SPACING_UNIT_PX < TAP_TARGET_MIN_PX) {
      violations.push({
        reason: "primary action under 48px without the tap-target class",
        detail: `${anyText(node).trim().slice(0, 30)} [${className}]`,
      });
    }
  }
  return violations;
}

function renderHindi(ui: React.ReactElement): HTMLElement {
  const { container } = render(<LocaleProvider initialLocale="hi">{ui}</LocaleProvider>);
  return container;
}

describe("360 px Hindi layout and reflow guard", () => {
  it("defines the tap-target class as at least 48 px through the spacing token", () => {
    const tokenValue = /--spacing-tap:\s*([\d.]+)rem/.exec(TOKENS_CSS)?.[1];
    expect(tokenValue).toBeDefined();
    expect(Number(tokenValue) * 16).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);

    const tapRule = /\.tap-target\s*\{[^}]*\}/.exec(GLOBALS_CSS)?.[0] ?? "";
    expect(tapRule).toContain("var(--spacing-tap)");
    expect(tapRule).toContain("min-height");
    expect(tapRule).toContain("min-width");
  });

  it("keeps the public fund view inside 360 px with reflow-clean Hindi text", () => {
    const container = renderHindi(<PublicFundView fund={SANITIZED_DEMO_FUND} />);
    expect(layoutViolations(container)).toEqual([]);
    expect(tapTargetViolations(container)).toEqual([]);
  });

  it("keeps the donate screen inside 360 px with reflow-clean Hindi text", () => {
    const container = renderHindi(
      <DonationForm
        fundTitle="उत्सव निधि 2026"
        upiVpa="utsav@yenbank"
        upiPayeeName="Utsav Committee"
        onSubmit={async () => "pledged"}
      />,
    );
    expect(layoutViolations(container)).toEqual([]);
    expect(tapTargetViolations(container)).toEqual([]);
  });

  it("keeps the approvals screen inside 360 px with reflow-clean Hindi text", () => {
    const container = renderHindi(
      <>
        <ExpenseTimeline
          status="submitted"
          amountPaise={paise(125000)}
          payeeName="हार्डवेयर स्टोर"
          createdAt="2026-10-28 10:00"
          submittedAt="2026-10-28 10:05"
          holdReservedAt="2026-10-28 10:05"
          approvals={[
            { approverId: "appr-1", approverName: "आशा राव", approvedAt: "2026-10-28 10:15" },
          ]}
          requiredQuorum={2}
        />
        <ApprovalPinModal
          isOpen
          onClose={() => {}}
          onConfirm={() => {}}
          amountPaise={paise(125000)}
          payeeName="हार्डवेयर स्टोर"
          fundId="fund-1"
          targetId="expense-1"
          action="expense:approve"
        />
      </>,
    );
    expect(layoutViolations(container)).toEqual([]);
    expect(tapTargetViolations(container)).toEqual([]);
  });

  it("keeps the treasurer dashboard inside 360 px with reflow-clean Hindi text", async () => {
    fetchFundTreasurerData.mockResolvedValue({
      fundId: "fund-1",
      fundName: "उत्सव निधि 2026",
      totalBalancePaise: paise(50000000),
      spendableBalancePaise: paise(32000000),
      pendingExpenses: [
        {
          id: "exp-1",
          fundId: "fund-1",
          amountPaise: paise(125000),
          payeeName: "हार्डवेयर स्टोर",
          payeeUpi: "store@bank",
          purpose: "मोटर खरीद",
          status: "submitted",
          requesterId: "psn-1",
          requesterName: "राहुल शर्मा",
          createdAt: "2026-10-28 10:00",
          submittedAt: "2026-10-28 10:05",
        },
      ],
    });

    const { default: TreasurerPage } = await import("./funds/[fundId]/treasurer/page");
    const { container } = render(
      <LocaleProvider initialLocale="hi">
        <TreasurerPage params={Promise.resolve({ fundId: "fund-1" })} />
      </LocaleProvider>,
    );
    await vi.waitFor(() => {
      expect(fetchFundTreasurerData).toHaveBeenCalled();
    });

    expect(layoutViolations(container)).toEqual([]);
    expect(tapTargetViolations(container)).toEqual([]);
  });

  it("keeps the verify screen inside 360 px with reflow-clean Hindi text", async () => {
    const { default: VerifyPage } = await import("./verify/page");
    const container = renderHindi(<VerifyPage />);
    expect(layoutViolations(container)).toEqual([]);
    expect(tapTargetViolations(container)).toEqual([]);
  });
});
