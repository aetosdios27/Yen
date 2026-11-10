import { beforeEach, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { OnboardingWizard } from "./onboarding-wizard";
import { OwnerInviteAccept } from "./owner-invite-accept";

const mockGet = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockGet }),
}));

beforeEach(() => {
  window.localStorage.clear();
  mockGet.mockReturnValue("invite-code-123");
});

it("has no axe violations on the onboarding wizard in English", async () => {
  await expectNoA11yViolations(<OnboardingWizard />, "en");
});

it("has no axe violations on the onboarding wizard in Hindi", async () => {
  await expectNoA11yViolations(<OnboardingWizard />, "hi");
});

it("has no axe violations on invite redemption in English", async () => {
  await expectNoA11yViolations(<OwnerInviteAccept />, "en");
});

it("has no axe violations on invite redemption in Hindi", async () => {
  await expectNoA11yViolations(<OwnerInviteAccept />, "hi");
});

it("has no axe violations when the invite link carries no code", async () => {
  mockGet.mockReturnValue(null);
  await expectNoA11yViolations(<OwnerInviteAccept />, "hi");
});
