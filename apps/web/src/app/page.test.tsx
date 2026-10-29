import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LocaleProvider, useI18n } from "../i18n";
import Home from "./page";

it("renders the hero, the trust explainer, the three steps and the waitlist", () => {
  render(
    <LocaleProvider>
      <main>
        <Home />
      </main>
    </LocaleProvider>,
  );

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Community money you can check.",
  );
  expect(screen.getByRole("link", { name: "Join the pilot waitlist" }).getAttribute("href")).toBe(
    "#waitlist",
  );

  const questions = screen.getAllByRole("group");
  expect(questions.length).toBe(4);
  expect(screen.getByText("What stops someone editing a record?")).toBeDefined();

  const steps = screen.getAllByRole("listitem");
  expect(steps.length).toBe(3);
  expect(steps[0]?.textContent).toContain("Collect by UPI");
  expect(steps[2]?.textContent).toContain("Check the public record");

  expect(screen.getByRole("form", { name: "Join the pilot waitlist" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Join the pilot waitlist" })).toBeDefined();
});

function LocaleHarness() {
  const { setLocale } = useI18n();
  return (
    <main>
      <button type="button" onClick={() => setLocale("hi")}>
        Switch to Hindi
      </button>
      <Home />
    </main>
  );
}

it("flips the whole landing page to Hindi without a reload", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider initialLocale="en">
      <LocaleHarness />
    </LocaleProvider>,
  );

  expect(document.title).toBe("Yen");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Community money you can check.",
  );

  await user.click(screen.getByRole("button", { name: "Switch to Hindi" }));

  expect(window.location.pathname).toBe("/");
  expect(document.title).toBe("येन");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "सामुदायिक धन, जिसे आप जाँच सकते हैं।",
  );
  expect(screen.getByRole("link", { name: "पायलट की प्रतीक्षा सूची में जुड़ें" })).toBeDefined();
});
