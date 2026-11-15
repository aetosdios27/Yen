import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DesignSystemReview } from "../app/design-system/design-system-review";
import Home from "../app/page";
import { AppShell } from "../components/app-shell";
import { LocaleProvider } from "./locale-provider";
import { hi } from "./messages/hi";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("../lib/product-session", () => ({
  useProductSession: () => ({ session: { kind: "signedOut" }, retry: vi.fn() }),
}));

it("switches the whole shell to Hindi without a page reload", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider>
      <AppShell>
        <Home />
      </AppShell>
    </LocaleProvider>,
  );

  expect(screen.getByRole("heading", { name: "Your funds" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Account" }));

  await user.selectOptions(screen.getByLabelText("Language"), "hi");
  await user.keyboard("{Escape}");

  expect(screen.getByRole("heading", { name: hi.product.funds })).toBeTruthy();
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
