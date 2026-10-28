import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { runAxe } from "../test/a11y";
import { DonationForm } from "./donation-form";

const payee = {
  fundTitle: "Festival",
  upiVpa: "festival@yenbank",
  upiPayeeName: "Festival Committee",
};

it.each(["en", "hi"] as const)("has no axe violations in %s", async (locale) => {
  const { container } = render(
    <LocaleProvider initialLocale={locale}>
      <main>
        <DonationForm {...payee} onSubmit={async () => "pledged"} />
      </main>
    </LocaleProvider>,
  );

  expect(await runAxe(container)).toHaveNoViolations();
});

it("has no axe violations while showing validation errors", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <LocaleProvider>
      <main>
        <DonationForm {...payee} onSubmit={async () => "pledged"} />
      </main>
    </LocaleProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Record my donation" }));
  expect(screen.getByText("Enter the 12-digit UPI reference.")).toBeDefined();
  expect(await runAxe(container)).toHaveNoViolations();
});

it("has no axe violations after the pledge is recorded", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <LocaleProvider>
      <main>
        <DonationForm {...payee} onSubmit={async () => "pledged"} />
      </main>
    </LocaleProvider>,
  );

  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));
  await screen.findByRole("status");
  expect(await runAxe(container)).toHaveNoViolations();
});
