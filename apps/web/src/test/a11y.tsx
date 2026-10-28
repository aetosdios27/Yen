import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";
import { axe } from "vitest-axe";
import { type Locale, LocaleProvider } from "../i18n";

/**
 * jsdom has no layout or CSS cascade, so axe cannot compute colour contrast.
 * Every token pair is checked in `src/styles/tokens.test.ts` instead.
 */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

export function runAxe(container: Element) {
  return axe(container, AXE_OPTIONS);
}

export async function expectNoA11yViolations(
  ui: ReactElement,
  locale: Locale = "en",
): Promise<void> {
  const { container } = render(
    <LocaleProvider initialLocale={locale}>
      <main>{ui}</main>
    </LocaleProvider>,
  );

  expect(await runAxe(container)).toHaveNoViolations();
}
