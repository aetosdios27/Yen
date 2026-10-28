import { paise } from "@yen/shared";
import { describe, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Input } from "./input";
import { Money } from "./money";
import { StatusBadge } from "./status-badge";
import { Stepper } from "./stepper";
import { Timeline } from "./timeline";
import { Toast } from "./toast";

const timelineItems = [
  {
    id: "donation",
    title: "Donation received",
    description: "The bank confirmed the payment.",
    dateTime: "2026-10-24T10:30:00+05:30",
    timestamp: "24 Oct 2026, 10:30",
    tone: "positive" as const,
  },
  {
    id: "expense",
    title: "Expense approved",
    description: "Three approvers confirmed the bill.",
    dateTime: "2026-10-25T16:05:00+05:30",
    timestamp: "25 Oct 2026, 16:05",
    tone: "neutral" as const,
  },
];

describe("core component accessibility", () => {
  it("Button", async () => {
    await expectNoA11yViolations(
      <div className="flex flex-col gap-2">
        <Button>Record a donation</Button>
        <Button variant="secondary">View fund</Button>
        <Button variant="danger">Cancel request</Button>
        <Button variant="ghost">See all records</Button>
        <Button loading>Saving</Button>
      </div>,
    );
  });

  it("Input", async () => {
    await expectNoA11yViolations(
      <div className="flex flex-col gap-4">
        <Input label="Donor name" hint="Use the bank statement name." />
        <Input
          label="Donor phone"
          hint="Used only to send the receipt."
          error="Enter a 10-digit phone number."
        />
      </div>,
    );
  });

  it("Money", async () => {
    await expectNoA11yViolations(<Money amount={paise(123456789012)} label="Fund balance" />);
  });

  it("StatusBadge", async () => {
    await expectNoA11yViolations(
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="verified" />
        <StatusBadge status="pending" />
        <StatusBadge status="unmatched" />
        <StatusBadge status="rejected" />
      </div>,
    );
  });

  it("Timeline", async () => {
    await expectNoA11yViolations(<Timeline items={timelineItems} label="Record history" />);
  });

  it("Stepper", async () => {
    await expectNoA11yViolations(
      <Stepper
        label="Fund setup progress"
        current={2}
        steps={[
          { id: "fund-details", label: "Fund details" },
          { id: "approvers", label: "Approvers" },
          { id: "review", label: "Review" },
        ]}
      />,
    );
  });

  it("Toast", async () => {
    await expectNoA11yViolations(
      <Toast
        tone="success"
        title="Fund saved"
        description="The updated details are visible to every member."
        onClose={() => undefined}
      />,
    );
  });

  it("EmptyState", async () => {
    await expectNoA11yViolations(
      <EmptyState
        title="No expenses yet"
        description="When the treasurer records a bill, it will appear here."
        action={<Button variant="secondary">Record an expense</Button>}
      />,
    );
  });
});
