import { render, screen } from "@testing-library/react";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { Money } from "./money";

describe("Money", () => {
  it.each([
    [0, "₹0.00"],
    [5, "₹0.05"],
    [1005, "₹10.05"],
    [100550, "₹1,005.50"],
    [123456789012, "₹1,23,45,67,890.12"],
    [999999999999, "₹9,99,99,99,999.99"],
    [-5050, "-₹50.50"],
  ])("renders %i paise as %s in English", (amount, expected) => {
    render(
      <LocaleProvider initialLocale="en">
        <Money amount={paise(amount)} label="Amount" />
      </LocaleProvider>,
    );

    const rendered = screen.getByText(expected);
    expect(rendered.tagName).toBe("DATA");
    expect(rendered.textContent).toBe(expected);
    expect(rendered.textContent).not.toMatch(/e[+-]/i);
  });

  it.each([
    [10000000, "₹1,00,000.00"],
    [123456700, "₹12,34,567.00"],
    [100000000000, "₹1,00,00,00,000.00"],
  ])("keeps lakh and crore grouping in Hindi for %i paise", (amount, expected) => {
    render(
      <LocaleProvider initialLocale="hi">
        <Money amount={paise(amount)} />
      </LocaleProvider>,
    );

    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("shows the optional label without changing the amount", () => {
    render(
      <LocaleProvider initialLocale="en">
        <Money amount={paise(1005)} label="Fund balance" />
      </LocaleProvider>,
    );

    expect(screen.getByText("Fund balance")).toBeTruthy();
    expect(screen.getByText("₹10.05").textContent).toBe("₹10.05");
  });
});
