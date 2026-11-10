import { render } from "@testing-library/react";
import { paise } from "@yen/shared";
import { expect, it } from "vitest";
import { LocaleProvider } from "../../i18n";
import { FundTimeline } from "./fund-timeline";

it.each([
  ["en", "Donation refunded", "Refund"],
  ["hi", "दान वापस किया गया", "धन वापसी"],
] as const)("renders the refund movement in %s", (locale, title, label) => {
  const { getByRole, container } = render(
    <LocaleProvider initialLocale={locale}>
      <FundTimeline
        timeline={[
          {
            id: "refund",
            type: "refund",
            title: "API fallback",
            amount: paise(5000),
            dateTime: "2026-11-01T12:00:00Z",
            status: "pending",
            verification: { status: "pending" },
          },
        ]}
        onOpenExplainer={() => {}}
      />
    </LocaleProvider>,
  );
  expect(getByRole("heading", { level: 3 }).textContent).toBe(title);
  expect(container.textContent).toContain(label);
});
