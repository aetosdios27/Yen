import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { expectNoA11yViolations } from "../test/a11y";
import { InstallPrompt } from "./install-prompt";
import type { BeforeInstallPromptEvent } from "./use-install-prompt";

function renderWithI18n(ui: React.ReactElement, locale = "en") {
  return render(<LocaleProvider initialLocale={locale as "en"}>{ui}</LocaleProvider>);
}

describe("InstallPrompt component", () => {
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
  });

  function triggerBeforeInstallPrompt(): { promptCalled: boolean } {
    const status = { promptCalled: false };
    const event = Object.assign(new Event("beforeinstallprompt"), {
      platforms: ["web"],
      userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
      prompt: vi.fn().mockImplementation(() => {
        status.promptCalled = true;
        return Promise.resolve();
      }),
    }) as BeforeInstallPromptEvent;

    act(() => {
      window.dispatchEvent(event);
    });
    return status;
  }

  it("is NEVER shown on first paint without trigger or second page view", () => {
    const { container } = renderWithI18n(<InstallPrompt />);
    triggerBeforeInstallPrompt();
    // On first mount without trigger, session views is 1 (< 2), so banner must remain hidden
    expect(container.querySelector("section")).toBeNull();
  });

  it("shows after useful activity (second session page view) when prompt event occurs", () => {
    window.sessionStorage.setItem("yen_pwa_session_views", "1");

    renderWithI18n(<InstallPrompt />);
    triggerBeforeInstallPrompt();

    expect(screen.getByRole("region", { name: "Install Yen" })).toBeDefined();
    expect(screen.getByText("Install Yen")).toBeDefined();
    expect(
      screen.getByText(
        "Add Yen to your home screen for quick access. It takes almost no storage and works even on slow connections.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Install app" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDefined();
  });

  it("shows on first page view when action trigger override is provided", () => {
    renderWithI18n(<InstallPrompt trigger={true} />);
    triggerBeforeInstallPrompt();

    expect(screen.getByRole("region", { name: "Install Yen" })).toBeDefined();
  });

  it("remembers dismissal in localStorage with future expiry and hides banner", () => {
    window.sessionStorage.setItem("yen_pwa_session_views", "1");
    const { rerender } = renderWithI18n(<InstallPrompt />);
    triggerBeforeInstallPrompt();

    const dismissBtn = screen.getByRole("button", { name: "Not now" });
    fireEvent.click(dismissBtn);

    const dismissedUntil = window.localStorage.getItem("yen_pwa_dismissed_until");
    expect(dismissedUntil).not.toBeNull();
    expect(Number(dismissedUntil)).toBeGreaterThan(Date.now());

    // Banner is dismissed and unmounted
    expect(screen.queryByRole("region", { name: "Install Yen" })).toBeNull();

    // Re-rendering does not show it while unexpired
    rerender(
      <LocaleProvider initialLocale="en">
        <InstallPrompt trigger={true} />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("region", { name: "Install Yen" })).toBeNull();
  });

  it("shows banner again once dismissal timestamp has expired", () => {
    // Set expired dismissal
    window.localStorage.setItem("yen_pwa_dismissed_until", String(Date.now() - 5000));
    window.sessionStorage.setItem("yen_pwa_session_views", "1");

    renderWithI18n(<InstallPrompt />);
    triggerBeforeInstallPrompt();

    expect(screen.getByRole("region", { name: "Install Yen" })).toBeDefined();
  });

  it("calls prompt() when install button is clicked", () => {
    window.sessionStorage.setItem("yen_pwa_session_views", "1");
    renderWithI18n(<InstallPrompt />);
    const promptStatus = triggerBeforeInstallPrompt();

    const installBtn = screen.getByRole("button", { name: "Install app" });
    fireEvent.click(installBtn);
    expect(promptStatus.promptCalled).toBe(true);
  });

  it("provides iOS Add to Home Screen instructions only upon user request", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });
    window.sessionStorage.setItem("yen_pwa_session_views", "1");

    renderWithI18n(<InstallPrompt />);

    // Shows trigger button, not full instructions initially
    const triggerBtn = screen.getByRole("button", { name: "Add to Home Screen on iPhone" });
    expect(screen.queryByText(/Tap the Share button in Safari/)).toBeNull();

    // Clicking trigger reveals instructions on user request
    fireEvent.click(triggerBtn);
    expect(screen.getByText(/Tap the Share button in Safari/)).toBeDefined();

    // Close button hides instructions
    const closeBtn = screen.getByRole("button", { name: "Close instructions" });
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Tap the Share button in Safari/)).toBeNull();
  });

  it("renders in Hindi with honest copy and no English leak", () => {
    window.sessionStorage.setItem("yen_pwa_session_views", "1");
    renderWithI18n(<InstallPrompt />, "hi");
    triggerBeforeInstallPrompt();

    expect(screen.getByRole("region", { name: "येन इंस्टॉल करें" })).toBeDefined();
    expect(screen.getByText("येन इंस्टॉल करें")).toBeDefined();
    expect(screen.getByRole("button", { name: "ऐप इंस्टॉल करें" })).toBeDefined();
    expect(screen.getByRole("button", { name: "अभी नहीं" })).toBeDefined();
  });

  it("passes axe accessibility checks without violations", async () => {
    await expectNoA11yViolations(<InstallPrompt trigger={true} />);
  });
});
