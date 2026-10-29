import { describe, it } from "vitest";
import { expectNoA11yViolations } from "../../test/a11y";
import { SANITIZED_DEMO_FUND } from "./data";
import { FundHeader } from "./fund-header";
import { FundTimeline } from "./fund-timeline";
import { HowDoIKnowModal } from "./how-do-i-know-modal";
import { MoneySummary } from "./money-summary";
import { PublicFundView } from "./public-fund-view";
import { SpendingBreakdown } from "./spending-breakdown";

describe("Public Fund Accessibility (axe-core)", () => {
  it("FundHeader (English)", async () => {
    await expectNoA11yViolations(
      <FundHeader
        fundId={SANITIZED_DEMO_FUND.id}
        name={SANITIZED_DEMO_FUND.name}
        purpose={SANITIZED_DEMO_FUND.purpose}
        org={SANITIZED_DEMO_FUND.org}
      />,
      "en",
    );
  });

  it("FundHeader (Hindi)", async () => {
    await expectNoA11yViolations(
      <FundHeader
        fundId={SANITIZED_DEMO_FUND.id}
        name={SANITIZED_DEMO_FUND.name}
        purpose={SANITIZED_DEMO_FUND.purpose}
        org={SANITIZED_DEMO_FUND.org}
      />,
      "hi",
    );
  });

  it("MoneySummary (English)", async () => {
    await expectNoA11yViolations(<MoneySummary money={SANITIZED_DEMO_FUND.money} />, "en");
  });

  it("MoneySummary (Hindi)", async () => {
    await expectNoA11yViolations(<MoneySummary money={SANITIZED_DEMO_FUND.money} />, "hi");
  });

  it("SpendingBreakdown (English)", async () => {
    await expectNoA11yViolations(
      <SpendingBreakdown categories={SANITIZED_DEMO_FUND.spendingBreakdown} />,
      "en",
    );
  });

  it("SpendingBreakdown (Hindi)", async () => {
    await expectNoA11yViolations(
      <SpendingBreakdown categories={SANITIZED_DEMO_FUND.spendingBreakdown} />,
      "hi",
    );
  });

  it("FundTimeline (English)", async () => {
    await expectNoA11yViolations(
      <FundTimeline timeline={SANITIZED_DEMO_FUND.timeline} onOpenExplainer={() => undefined} />,
      "en",
    );
  });

  it("FundTimeline (Hindi)", async () => {
    await expectNoA11yViolations(
      <FundTimeline timeline={SANITIZED_DEMO_FUND.timeline} onOpenExplainer={() => undefined} />,
      "hi",
    );
  });

  it("HowDoIKnowModal open (English)", async () => {
    await expectNoA11yViolations(<HowDoIKnowModal isOpen={true} onClose={() => undefined} />, "en");
  });

  it("HowDoIKnowModal open (Hindi)", async () => {
    await expectNoA11yViolations(<HowDoIKnowModal isOpen={true} onClose={() => undefined} />, "hi");
  });

  it("PublicFundView integrated (English)", async () => {
    await expectNoA11yViolations(<PublicFundView fund={SANITIZED_DEMO_FUND} />, "en");
  });

  it("PublicFundView integrated (Hindi)", async () => {
    await expectNoA11yViolations(<PublicFundView fund={SANITIZED_DEMO_FUND} />, "hi");
  });
});
