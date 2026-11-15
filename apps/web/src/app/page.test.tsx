import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import Home from "./page";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => vi.unstubAllGlobals());
function show(funds: unknown[], locale: "en" | "hi" = "en") {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Priya" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ funds }) }),
  );
  render(
    <LocaleProvider initialLocale={locale}>
      <Home />
    </LocaleProvider>,
  );
}
it("offers real onboarding when no funds exist", async () => {
  show([]);
  expect((await screen.findByRole("link", { name: "Create a fund" })).getAttribute("href")).toBe(
    "/onboarding",
  );
  expect(screen.queryByText(/waitlist/i)).toBeNull();
});
it("lets people choose among their own funds", async () => {
  show([
    { id: "one", title: "Residents", role: "member", visibility: "members" },
    { id: "two", title: "Sports club", role: "owner", visibility: "private" },
  ]);
  expect((await screen.findByRole("link", { name: /Residents/ })).getAttribute("href")).toBe(
    "/funds/one",
  );
  expect(screen.getByRole("link", { name: /Sports club/ }).getAttribute("href")).toBe(
    "/funds/two/dashboard",
  );
});
it("opens the only fund directly", async () => {
  replace.mockClear();
  show([{ id: "one", title: "Residents", role: "member", visibility: "members" }]);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/funds/one"));
});

it("keeps Hindi selected while opening an auditor’s read-only fund", async () => {
  replace.mockClear();
  show([{ id: "audit", title: "Residents", role: "auditor", visibility: "members" }], "hi");
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/funds/audit"));
  expect(document.documentElement.lang).toBe("hi");
});
