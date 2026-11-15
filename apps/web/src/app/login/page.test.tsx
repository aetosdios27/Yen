import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { expectNoA11yViolations } from "../../test/a11y";
import LoginPage from "./page";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

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

  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  async function signInUntilPinStep(responses: ReturnType<typeof jsonResponse>[]) {
    const fetchMock = vi.fn();
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
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
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    return fetchMock;
  }

  const sentOk = jsonResponse(200, { status: "sent", resendAfterSeconds: 60 });
  const verifiedOk = jsonResponse(200, { status: "authenticated", session: { id: "s" } });

  it("shows the simulated code notice and prefills the code when delivery is simulated", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { status: "sent", simulatedDelivery: { code: "654321" } }),
        ),
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
      expect(screen.getByRole("status").textContent).toBe(
        "Simulated delivery: no message was sent from this environment. Your code is 654321.",
      );
    });
    expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe("654321");
  });

  it("shows no simulated notice when the API does not simulate delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sentOk));
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
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe("");
  });

  it("unlocks the device before routing to the actual fund dashboard", async () => {
    replace.mockClear();
    const fetchMock = await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: true, status: "active" }),
      jsonResponse(200, { status: "unlocked" }),
      jsonResponse(200, { name: "Priya" }),
      jsonResponse(200, {
        funds: [
          { id: "actual-fund", title: "Residents", role: "treasurer", visibility: "members" },
        ],
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Enter your PIN" })).toBeTruthy();
    });
    expect(screen.queryByLabelText("Confirm PIN")).toBeNull();
    fireEvent.change(screen.getByLabelText("6-digit PIN"), { target: { value: "482613" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
      expect(screen.getByText("You are signed in to Yen.")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/auth/device/unlock"),
      expect.objectContaining({ body: JSON.stringify({ pin: "482613" }), credentials: "include" }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/funds/actual-fund/dashboard"));
  });

  it("creates a PIN for a first sign-in and requires both entries to match", async () => {
    const fetchMock = await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: false, status: "not_set" }),
      jsonResponse(201, { status: "created", isSet: true }),
    ]);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Create your approval PIN" }),
      ).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("6-digit PIN"), { target: { value: "482613" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "482614" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PIN and continue" }));
    await waitFor(() => {
      expect(screen.getByText("The two PINs do not match.")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "482613" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PIN and continue" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/auth/pin/setup"),
      expect.objectContaining({ body: JSON.stringify({ pin: "482613" }) }),
    );
  });

  it("reports a wrong PIN without leaving the PIN step", async () => {
    await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: true, status: "active" }),
      jsonResponse(401, { error: { code: "unauthenticated" } }),
      jsonResponse(200, { isSet: true, status: "active" }),
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit PIN")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("6-digit PIN"), { target: { value: "111222" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Wrong PIN, try again.");
    });
  });

  it("returns to the phone step when the session expired during the PIN step", async () => {
    await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: false, status: "not_set" }),
      jsonResponse(401, { error: { code: "unauthenticated" } }),
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText("Confirm PIN")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("6-digit PIN"), { target: { value: "482613" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "482613" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PIN and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    });
    expect(
      screen.getByText("Your sign-in expired. Enter your phone number to start again."),
    ).toBeTruthy();
  });

  it("treats an unlock 401 as expired when the session is gone", async () => {
    await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: true, status: "active" }),
      jsonResponse(401, { error: { code: "unauthenticated" } }),
      jsonResponse(401, { error: { code: "unauthenticated" } }),
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit PIN")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("6-digit PIN"), { target: { value: "482613" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock and continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    });
    expect(screen.getByText(/Your sign-in expired/)).toBeTruthy();
  });

  it("keeps the user on the PIN step and retries when the PIN status call fails", async () => {
    await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(500, { error: { code: "internal" } }),
      jsonResponse(200, { isSet: true, status: "active" }),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Something went wrong. Please try again.");
    });
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit PIN")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Unlock and continue" })).toBeTruthy();
  });

  it("lets the user start over from the PIN step", async () => {
    await signInUntilPinStep([
      sentOk,
      verifiedOk,
      jsonResponse(200, { isSet: true, status: "active" }),
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText("6-digit PIN")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
  });

  it("starts the resend cooldown from the API's resendAfterSeconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse(200, { status: "sent", resendAfterSeconds: 45 })),
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
      expect(screen.getByRole("button", { name: "Resend code in 45s" })).toBeTruthy();
    });
  });

  it("passes axe accessibility checks in phone viewport", async () => {
    await expectNoA11yViolations(<LoginPage />);
  });
});
