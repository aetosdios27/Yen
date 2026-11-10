import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { OnboardingWizard } from "./onboarding-wizard";

it("removes legacy personal drafts and keeps entered names out of browser storage", async () => {
  localStorage.setItem("yen:onboarding:draft:v1", JSON.stringify({ clubName: "Legacy Person" }));
  render(<OnboardingWizard />);
  expect(localStorage.getItem("yen:onboarding:draft:v1")).toBeNull();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Club or organisation name/i), "Sensitive Person");
  expect(JSON.stringify(localStorage)).not.toContain("Sensitive Person");
});
