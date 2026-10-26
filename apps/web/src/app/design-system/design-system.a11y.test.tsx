import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { LocaleProvider } from "../../i18n";
import { runAxe } from "../../test/a11y";
import { DesignSystemReview } from "./design-system-review";

it("has no axe violations at phone width", async () => {
  const { container } = render(
    <LocaleProvider>
      <main>
        <DesignSystemReview />
      </main>
    </LocaleProvider>,
  );

  expect(await runAxe(container)).toHaveNoViolations();
});

it("has no axe violations in Hindi", async () => {
  const { container } = render(
    <LocaleProvider initialLocale="hi">
      <main>
        <DesignSystemReview />
      </main>
    </LocaleProvider>,
  );

  expect(await runAxe(container)).toHaveNoViolations();
});

it("has no axe violations with expanded pseudo-locale strings", async () => {
  const { container } = render(
    <LocaleProvider initialLocale="en-XA">
      <main>
        <DesignSystemReview />
      </main>
    </LocaleProvider>,
  );

  expect(await runAxe(container)).toHaveNoViolations();
});
