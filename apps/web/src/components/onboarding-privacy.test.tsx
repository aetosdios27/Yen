import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING_DRAFT } from "../lib/onboarding";
import { OnboardingWizard } from "./onboarding-wizard";

const key = "yen:onboarding:draft:v1";
it("resumes non-personal fields after remount and clamps to the first incomplete step", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  const first = render(<OnboardingWizard />);
  await user.type(screen.getByLabelText(/Club or organisation name/i), "Community Club");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText(/purpose/i), "Community garden");
  first.unmount();
  render(<OnboardingWizard />);
  expect(screen.getByLabelText<HTMLInputElement>(/purpose/i).value).toBe("Community garden");
  expect(screen.getByText("Step 2 of 5: Fund")).toBeDefined();
});
it("scrubs old personal fields on load and never persists typed payment or approver details", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      ...EMPTY_ONBOARDING_DRAFT,
      clubName: "Club",
      purpose: "Garden",
      targetPaise: "10000",
      step: 4,
      upiVpa: "private@upi",
      payeeName: "Private Payee",
      approvers: [{ name: "Private Approver", contact: "+919876543210" }],
    }),
  );
  const first = render(<OnboardingWizard />);
  expect(screen.getByText("Step 3 of 5: Payment")).toBeDefined();
  for (const value of ["private@upi", "Private Payee", "Private Approver", "+919876543210"])
    expect(localStorage.getItem(key)).not.toContain(value);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/UPI VPA/i), "typed@upi");
  await user.type(screen.getByLabelText(/payee name/i), "Typed Payee");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText("Approver 1 name"), "Typed Approver");
  await user.type(screen.getByLabelText("Approver 1 phone number"), "+919876543211");
  for (const value of ["typed@upi", "Typed Payee", "Typed Approver", "+919876543211"])
    expect(localStorage.getItem(key)).not.toContain(value);
  first.unmount();
  render(<OnboardingWizard />);
  expect(screen.getByText("Step 3 of 5: Payment")).toBeDefined();
});

it("removes the saved non-personal draft when onboarding completes", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ clubName: "Club", purpose: "Garden", targetPaise: "10000", step: 2 }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "fund-created", code: "invite-created" }),
    }),
  );
  try {
    render(<OnboardingWizard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/UPI VPA/i), "club@upi");
    await user.type(screen.getByLabelText(/payee name/i), "Payee");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    for (const n of [1, 2]) {
      await user.type(screen.getByLabelText(`Approver ${n} name`), `Approver ${n}`);
      await user.type(screen.getByLabelText(`Approver ${n} phone number`), `+91987654321${n}`);
    }
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Create fund" }));
    expect(localStorage.getItem(key)).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
