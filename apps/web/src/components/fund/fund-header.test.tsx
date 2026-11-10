import { isInaccessible, render } from "@testing-library/react";
import type { FundVerificationState } from "@yen/shared";
import { expect, it } from "vitest";
import { LocaleProvider } from "../../i18n";
import { FundHeader } from "./fund-header";

it.each([
  ["en", "unverified", "No bank matches yet"],
  ["en", "bank-matched", "Bank matched · anchoring incomplete"],
  ["en", "anchored", "All bank matches anchored"],
  ["hi", "unverified", "अभी कोई बैंक मिलान नहीं"],
  ["hi", "bank-matched", "बैंक मिलान हुआ · एंकरिंग अधूरी"],
  ["hi", "anchored", "सभी बैंक मिलान एंकर किए गए"],
] satisfies ["en" | "hi", FundVerificationState, string][])(
  "labels %s %s honestly and reserves the checkmark for complete anchoring",
  (locale, verification, label) => {
    const { container, getByText } = render(
      <LocaleProvider initialLocale={locale}>
        <FundHeader
          fundId="fund"
          name="Fund"
          purpose="Community"
          org={{ id: "org", name: "Club", verification }}
        />
      </LocaleProvider>,
    );
    expect(container.textContent).toContain(label);
    const badge = container.querySelector("header > div:first-child > span");
    expect(isInaccessible(getByText(label))).toBe(false);
    expect(badge?.querySelector('[aria-hidden="true"]')?.textContent ?? "").toBe(
      verification === "anchored" ? "✓" : "",
    );
    expect(container.textContent?.includes("✓")).toBe(verification === "anchored");
    expect(container.querySelector("header > div:first-child svg")).toBeNull();
  },
);
