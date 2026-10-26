import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { expectNoA11yViolations } from "../test/a11y";
import { AppFooter } from "./app-footer";

it("links the terms and privacy pages from the shared footer", () => {
  render(
    <LocaleProvider>
      <AppFooter />
    </LocaleProvider>,
  );

  const terms = screen.getByRole("link", { name: "Terms of use" });
  const privacy = screen.getByRole("link", { name: "Privacy notice" });
  expect(terms.getAttribute("href")).toBe("/terms");
  expect(privacy.getAttribute("href")).toBe("/privacy");
});

it("has no axe violations", async () => {
  await expectNoA11yViolations(<AppFooter />);
});
