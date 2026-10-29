import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { runAxe } from "../../test/a11y";
import { UnsubscribeClient } from "./unsubscribe-client";

function renderUnsubscribe(
  initialToken = "valid-token-123",
  apiUrl = "http://api.test",
  locale: "en" | "hi" = "en",
) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <main>
        <UnsubscribeClient initialToken={initialToken} apiUrl={apiUrl} />
      </main>
    </LocaleProvider>,
  );
}

describe("UnsubscribeClient", () => {
  it("shows error when token is missing", () => {
    renderUnsubscribe("");

    expect(screen.getByRole("alert").textContent).toContain("No unsubscribe link provided");
  });

  it("submits unsubscribe request and displays confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    try {
      renderUnsubscribe("sub-token-abc");

      expect(screen.getByRole("heading", { name: "Unsubscribe from fund updates" })).toBeDefined();

      const btn = screen.getByRole("button", { name: "Unsubscribe immediately" });
      await user.click(btn);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://api.test/v1/subscriptions/unsubscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "sub-token-abc" }),
        }),
      );

      const status = await screen.findByRole("status");
      expect(status.textContent).toContain("You have been unsubscribed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows error alert when unsubscribe request fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    try {
      renderUnsubscribe("invalid-token");

      const btn = screen.getByRole("button", { name: "Unsubscribe immediately" });
      await user.click(btn);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Could not process your request");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["en", "hi"] as const)("has no axe violations in %s", async (locale) => {
    const { container } = renderUnsubscribe("token-123", "http://api.test", locale);
    expect(await runAxe(container)).toHaveNoViolations();
  });
});
