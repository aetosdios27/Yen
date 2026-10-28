import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { expectNoA11yViolations } from "../../test/a11y";
import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders phone input and submit button in English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send code" })).toBeTruthy();
  });

  it("renders correctly in Hindi", () => {
    render(
      <LocaleProvider initialLocale="hi">
        <LoginPage />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "साइन इन करें" })).toBeTruthy();
    expect(screen.getByLabelText("फ़ोन नंबर")).toBeTruthy();
    expect(screen.getByRole("button", { name: "कोड भेजें" })).toBeTruthy();
  });

  it("validates phone number and announces error", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Enter a 10-digit phone number.");
    });
  });

  it("advances to OTP step when send succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          channel: "whatsapp",
          expiresInSeconds: 300,
          resendCooldownSeconds: 60,
        }),
      }),
    );

    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Enter code" })).toBeTruthy();
      expect(screen.getByLabelText("6-digit code")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Verify and continue" })).toBeTruthy();
    });
  });

  it("sends the selected SMS channel explicitly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, channel: "sms", resendCooldownSeconds: 60 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("Send code by"), { target: { value: "sms" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ phone: "9876543210", channel: "sms" }),
        }),
      );
    });
  });

  it("displays 'Wrong code, try again.' on invalid OTP code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // 1st call: send OTP
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, channel: "whatsapp", resendCooldownSeconds: 60 }),
        })
        // 2nd call: verify OTP failure
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: "INVALID_OTP",
            message: "Invalid OTP code",
            remainingAttempts: 2,
          }),
        }),
    );

    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit code")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Wrong code, try again.");
    });
  });

  it("completes verification and transitions to success view", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, channel: "sms", resendCooldownSeconds: 60 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            user: { id: "019488a0-0000-7000-8000-000000000001", phone: "+919876543210" },
            session: {
              id: "019488a0-0000-7000-8000-000000000002",
              expiresAt: "2026-10-29T00:00:00Z",
            },
          }),
        }),
    );

    render(
      <LocaleProvider initialLocale="en">
        <LoginPage />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit code")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
      expect(screen.getByText("You are signed in to Yen.")).toBeTruthy();
    });
  });

  it("passes axe accessibility checks in phone viewport", async () => {
    await expectNoA11yViolations(<LoginPage />);
  });
});
