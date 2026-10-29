import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { runAxe } from "../test/a11y";
import { WaitlistForm } from "./waitlist-form";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ status: "received" }),
  } as Response);
});

function renderForm(locale: "en" | "hi" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <main>
        <WaitlistForm />
      </main>
    </LocaleProvider>,
  );
}

const NAME = "Full name";
const CONTACT = "Phone or email";
const ORG = "Club, society or organisation";
const CONSENT = "I agree to be contacted on WhatsApp regarding the Yen pilot";
const SUBMIT = "Join the waitlist";

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(NAME), "Asha Rao");
  await user.type(screen.getByLabelText(CONTACT), "9876543210");
  await user.type(screen.getByLabelText(ORG), "Green Park Residents Welfare Association");
  await user.click(screen.getByLabelText(CONSENT));
}

it("reports every missing field and moves focus to the first one", async () => {
  const user = userEvent.setup();
  renderForm();

  await user.click(screen.getByRole("button", { name: SUBMIT }));

  expect(screen.getByText("Enter your full name.")).toBeDefined();
  expect(screen.getByText("Enter a 10-digit phone number or an email address.")).toBeDefined();
  expect(screen.getByText("Enter the name of your club, society or organisation.")).toBeDefined();
  expect(screen.getByText("Tick the box so we can contact you.")).toBeDefined();
  expect(document.activeElement).toBe(screen.getByLabelText(NAME));
});

it("rejects an invalid contact and clears the error once it is fixed", async () => {
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText(NAME), "Asha Rao");
  await user.type(screen.getByLabelText(CONTACT), "abc");
  await user.type(screen.getByLabelText(ORG), "Green Park Residents Welfare Association");
  await user.click(screen.getByLabelText(CONSENT));
  await user.click(screen.getByRole("button", { name: SUBMIT }));

  expect(screen.getByText("Enter a 10-digit phone number or an email address.")).toBeDefined();
  expect(document.activeElement).toBe(screen.getByLabelText(CONTACT));

  await user.type(screen.getByLabelText(CONTACT), "9876543210");
  expect(screen.queryByText("Enter a 10-digit phone number or an email address.")).toBeNull();
});

it("has no axe violations while the errors are announced", async () => {
  const user = userEvent.setup();
  const { container } = renderForm();

  await user.click(screen.getByRole("button", { name: SUBMIT }));

  expect(await runAxe(container)).toHaveNoViolations();
});

it("confirms a valid submission, records consent and dismisses the toast with Escape", async () => {
  const user = userEvent.setup();
  renderForm();

  await fillValidForm(user);
  await user.click(screen.getByRole("button", { name: SUBMIT }));

  expect(global.fetch).toHaveBeenCalledWith(
    "/v1/waitlist",
    expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Asha Rao",
        contact: "9876543210",
        org: "Green Park Residents Welfare Association",
        locale: "en",
        consent: {
          accepted: true,
          text: CONSENT,
          version: "2026-10-27",
        },
      }),
    }),
  );

  const shown = await screen.findAllByText("You are on the waitlist.");
  expect(shown.length).toBe(2);
  expect(document.activeElement?.textContent).toContain("You are on the waitlist.");
  expect(screen.getByText(/Consent recorded on .* I agree to be contacted/)).toBeDefined();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  expect(screen.getByText("You are on the waitlist.")).toBeDefined();
});

it("displays an honest error alert when the endpoint call fails", async () => {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: false,
    status: 500,
  } as Response);

  const user = userEvent.setup();
  const { container } = renderForm();

  await fillValidForm(user);
  await user.click(screen.getByRole("button", { name: SUBMIT }));

  expect(
    await screen.findByText(
      "Unable to submit your registration right now. Please try again later.",
    ),
  ).toBeDefined();
  expect(screen.queryByText("You are on the waitlist.")).toBeNull();
  expect(await runAxe(container)).toHaveNoViolations();
});

it("announces the confirmation in Hindi", async () => {
  const user = userEvent.setup();
  renderForm("hi");

  await user.type(screen.getByLabelText("पूरा नाम"), "आशा राव");
  await user.type(screen.getByLabelText("फ़ोन या ईमेल"), "9876543210");
  await user.type(screen.getByLabelText("क्लब, सोसाइटी या संस्था"), "ग्रीन पार्क आवासीय कल्याण संघ");
  await user.click(screen.getByLabelText("मैं येन पायलट के संबंध में व्हाट्सएप पर संपर्क किए जाने से सहमत हूँ"));
  await user.click(screen.getByRole("button", { name: "प्रतीक्षा सूची में जुड़ें" }));

  expect((await screen.findAllByText("आप सूची में जुड़ गए।")).length).toBe(2);
});
