import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { DonationForm, type DonationOutcome, type DonationPledge } from "./donation-form";

const payee = {
  fundTitle: "Festival",
  upiVpa: "festival@yenbank",
  upiPayeeName: "Festival Committee",
};

function renderForm(
  onSubmit: (pledge: DonationPledge) => Promise<DonationOutcome> = async () => "pledged",
) {
  return render(
    <LocaleProvider>
      <DonationForm {...payee} onSubmit={onSubmit} />
    </LocaleProvider>,
  );
}

function paymentLink(): URL {
  const link = screen.getByRole("link", { name: "Open your UPI app" });
  return new URL(link.getAttribute("href") ?? "");
}

it("names the fund, its UPI ID and offers a code to scan", () => {
  renderForm();

  expect(screen.getByRole("heading", { name: "Give to Festival" })).toBeDefined();
  expect(screen.getByText("festival@yenbank")).toBeDefined();
  expect(screen.getByRole("img", { name: "Scan to pay festival@yenbank" })).toBeDefined();
});

it("starts on ₹500 and follows the chosen chip", async () => {
  const user = userEvent.setup();
  renderForm();

  expect(paymentLink().searchParams.get("am")).toBe("500.00");

  await user.click(screen.getByRole("button", { name: "₹5000" }));
  expect(paymentLink().searchParams.get("am")).toBe("5000.00");
  expect(screen.getByRole("button", { name: "₹5000" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "₹500" }).getAttribute("aria-pressed")).toBe("false");
});

it("uses a typed amount instead of the chip", async () => {
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("Another amount in rupees"), "750.5");
  expect(paymentLink().searchParams.get("am")).toBe("750.50");
});

it("records the pledge with exact paise and says the bank decides", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("Another amount in rupees"), "750.5");
  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(onSubmit).toHaveBeenCalledWith({ amountPaise: 75_050, utr: "123456789012" });
  expect(await screen.findByRole("status")).toBeDefined();
  expect(
    screen.getByRole("heading", { name: "Donation recorded, waiting for the bank" }),
  ).toBeDefined();
  expect(screen.getByText(/We'll confirm this when the bank statement reflects it/)).toBeDefined();
});

it("sends the optional name and contact only when they are filled in", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.type(screen.getByLabelText("Name for the public record (optional)"), "Asha Rao");
  await user.type(
    screen.getByLabelText("Phone or email for your receipt (optional)"),
    "98765 43210",
  );
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(onSubmit).toHaveBeenCalledWith({
    amountPaise: 50_000,
    utr: "123456789012",
    donorName: "Asha Rao",
    donorContact: "98765 43210",
  });
});

it.each(["12345", "12345678901a", ""])(
  "asks for the reference instead of sending %s",
  async (value) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
    renderForm(onSubmit);

    if (value !== "") {
      await user.type(screen.getByLabelText("12-digit UPI reference"), value);
    }
    await user.click(screen.getByRole("button", { name: "Record my donation" }));

    expect(screen.getByText("Enter the 12-digit UPI reference.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("12-digit UPI reference"));
  },
);

it("focuses the amount first when both the amount and the reference are wrong", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("Another amount in rupees"), "12.345");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(screen.getByText("Enter an amount in rupees, for example 500.")).toBeDefined();
  expect(document.activeElement).toBe(screen.getByLabelText("Another amount in rupees"));
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps the pledge under the stated limit", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("Another amount in rupees"), "2000000");
  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(screen.getByText("Please enter an amount under ₹10,00,000.")).toBeDefined();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("refuses a receipt contact that is neither a phone nor an email", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "pledged");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.type(screen.getByLabelText("Phone or email for your receipt (optional)"), "call me");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(screen.getByText("Enter a phone number or an email address.")).toBeDefined();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("shows a taken reference on the field itself", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(
    async (_pledge: DonationPledge): Promise<DonationOutcome> => "duplicate_utr",
  );
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(await screen.findByText("This UPI reference is already recorded.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Record my donation" })).toBeDefined();
});

it("keeps the form usable when the request fails", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async (_pledge: DonationPledge): Promise<DonationOutcome> => "failed");
  renderForm(onSubmit);

  await user.type(screen.getByLabelText("12-digit UPI reference"), "123456789012");
  await user.click(screen.getByRole("button", { name: "Record my donation" }));

  expect(
    await screen.findByText("We could not record that donation. Please try again."),
  ).toBeDefined();
  expect((screen.getByLabelText("12-digit UPI reference") as HTMLInputElement).value).toBe(
    "123456789012",
  );
});

it("speaks Hindi", () => {
  render(
    <LocaleProvider initialLocale="hi">
      <DonationForm {...payee} onSubmit={async () => "pledged"} />
    </LocaleProvider>,
  );

  expect(screen.getByRole("heading", { name: "Festival को दान दें" })).toBeDefined();
  expect(screen.getByLabelText("12 अंकों का UPI संदर्भ")).toBeDefined();
});
