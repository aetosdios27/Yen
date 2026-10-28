import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { DesignSystemReview } from "../app/design-system/design-system-review";
import Home from "../app/page";
import { AppShell } from "../components/app-shell";
import { LocaleProvider } from "./locale-provider";

it("switches the whole shell to Hindi without a page reload", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider>
      <AppShell>
        <Home />
      </AppShell>
    </LocaleProvider>,
  );

  expect(screen.getByRole("link", { name: "Design system" })).toBeTruthy();
  expect(screen.getByText(/Community money you can check/)).toBeTruthy();

  await user.selectOptions(screen.getByLabelText("Language"), "hi");

  expect(screen.getByRole("link", { name: "डिज़ाइन सिस्टम" })).toBeTruthy();
  expect(screen.getByText(/सामुदायिक धन/)).toBeTruthy();
  expect(document.documentElement.lang).toBe("hi");
});

it("renders the phone review page with expanded pseudo-locale strings", () => {
  render(
    <LocaleProvider initialLocale="en-XA">
      <DesignSystemReview />
    </LocaleProvider>,
  );

  expect(screen.getAllByText(/⟦/).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
