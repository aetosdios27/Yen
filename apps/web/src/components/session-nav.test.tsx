import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { SESSION_CHANGED_EVENT, SessionNav } from "./session-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
afterEach(() => vi.unstubAllGlobals());
function renderNav() {
  render(
    <LocaleProvider initialLocale="en">
      <SessionNav />
    </LocaleProvider>,
  );
}
function ready(name: string) {
  return { ok: true, status: 200, json: async () => ({ name, funds: [] }) };
}
it("offers sign in inside the account menu", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  renderNav();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Account" }), {
    button: 0,
    ctrlKey: false,
  });
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign in" })).toBeTruthy());
});
it("refreshes the API name when login changes the session", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValue(ready("Priya Verma"));
  vi.stubGlobal("fetch", fetch);
  renderNav();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event(SESSION_CHANGED_EVENT)));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("Priya Verma"),
  );
});
