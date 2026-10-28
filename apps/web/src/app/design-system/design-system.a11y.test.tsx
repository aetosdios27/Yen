import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LocaleProvider, useI18n } from "../../i18n";
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

function TestHarness() {
  const { setLocale } = useI18n();
  return (
    <main>
      <button type="button" onClick={() => setLocale("hi")}>
        Switch to Hindi
      </button>
      <DesignSystemReview />
    </main>
  );
}

it("updates document.title and meta description when switching language to Hindi", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider initialLocale="en">
      <TestHarness />
    </LocaleProvider>,
  );

  expect(document.title).toBe("Design system · Yen");
  expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
    "A 375 px review of Yen design tokens, components and languages.",
  );

  await user.click(screen.getByRole("button", { name: "Switch to Hindi" }));

  expect(document.title).toBe("डिज़ाइन सिस्टम · Yen");
  expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
    "375 पिक्सल फ़ोन चौड़ाई पर येन टोकन, घटकों और भाषाओं की समीक्षा।",
  );
});
