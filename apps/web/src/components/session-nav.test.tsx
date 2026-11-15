import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { SESSION_CHANGED_EVENT, SessionNav } from "./session-nav";

function renderNav() {
  render(
    <LocaleProvider initialLocale="en">
      <SessionNav />
    </LocaleProvider>,
  );
}

describe("SessionNav", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers sign in when there is no session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    renderNav();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/me"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("names the signed-in person and signs out through the API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ displayName: "Priya Verma" }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "logged_out" }) });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    renderNav();

    await waitFor(() => {
      expect(screen.getByText("Signed in as Priya Verma")).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/v1/auth/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("refreshes after the login page reports a new session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ displayName: "Rohan Iyer" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    renderNav();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(screen.getByText("Signed in as Rohan Iyer")).toBeTruthy();
    });
  });
});
