import { it } from "vitest";
import { LegalPage } from "../components/legal-page";
import { expectNoA11yViolations } from "../test/a11y";
import Home from "./page";

it("has no axe violations on the landing page in English", async () => {
  await expectNoA11yViolations(<Home />);
});

it("has no axe violations on the landing page in Hindi", async () => {
  await expectNoA11yViolations(<Home />, "hi");
});

it("has no axe violations on the terms page in English", async () => {
  await expectNoA11yViolations(<LegalPage page="terms" />);
});

it("has no axe violations on the terms page in Hindi", async () => {
  await expectNoA11yViolations(<LegalPage page="terms" />, "hi");
});

it("has no axe violations on the privacy page in English", async () => {
  await expectNoA11yViolations(<LegalPage page="privacy" />);
});

it("has no axe violations on the privacy page in Hindi", async () => {
  await expectNoA11yViolations(<LegalPage page="privacy" />, "hi");
});
