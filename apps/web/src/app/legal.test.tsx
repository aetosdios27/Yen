import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LegalPage } from "../components/legal-page";
import { LocaleProvider, useI18n } from "../i18n";

it("explains that Yen is a technology service and never holds money", () => {
  render(
    <LocaleProvider>
      <main>
        <LegalPage page="terms" />
      </main>
    </LocaleProvider>,
  );

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms of use");
  expect(
    screen.getByRole("heading", { name: "Yen is a technology service, not a bank" }),
  ).toBeDefined();
  expect(screen.getByRole("heading", { name: "Your money stays yours" })).toBeDefined();
});

it("states the data minimisation promises of the privacy notice", () => {
  render(
    <LocaleProvider>
      <main>
        <LegalPage page="privacy" />
      </main>
    </LocaleProvider>,
  );

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy notice");
  expect(screen.getByRole("heading", { name: "What we collect" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "No tracking" })).toBeDefined();
});

function LocaleHarness() {
  const { setLocale } = useI18n();
  return (
    <main>
      <button type="button" onClick={() => setLocale("hi")}>
        Switch to Hindi
      </button>
      <LegalPage page="terms" />
    </main>
  );
}

it("translates the terms page title without a reload", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider initialLocale="en">
      <LocaleHarness />
    </LocaleProvider>,
  );

  expect(document.title).toBe("Terms of use");

  await user.click(screen.getByRole("button", { name: "Switch to Hindi" }));

  expect(window.location.pathname).toBe("/");
  expect(document.title).toBe("उपयोग की शर्तें");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("उपयोग की शर्तें");
  expect(screen.getByRole("heading", { name: "येन एक तकनीकी सेवा है, बैंक नहीं" })).toBeDefined();
});
