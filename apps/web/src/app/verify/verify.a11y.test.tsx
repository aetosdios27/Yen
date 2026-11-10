import { it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/a11y";
import VerifyPage from "./page";

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/verify",
}));

it("has no axe violations on the verify page in English", async () => {
  await expectNoA11yViolations(<VerifyPage />);
});

it("has no axe violations on the verify page in Hindi", async () => {
  await expectNoA11yViolations(<VerifyPage />, "hi");
});
