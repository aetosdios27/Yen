import { render, screen } from "@testing-library/react";
import { paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { ExpenseTimeline } from "./expense-timeline";

describe("ExpenseTimeline", () => {
  it("renders human-readable timeline for a submitted expense in progress", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseTimeline
          status="submitted"
          amountPaise={paise(50000)}
          payeeName="Ramesh Electricals"
          createdAt="2026-10-28 10:00 AM"
          submittedAt="2026-10-28 10:05 AM"
          holdReservedAt="2026-10-28 10:05 AM"
          requiredQuorum={2}
          approvals={[
            {
              approverId: "user-1",
              approverName: "Asha Rao",
              approvedAt: "2026-10-28 10:15 AM",
            },
          ]}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("list", { name: "Request progress" })).toBeTruthy();
    expect(screen.getByText("Draft created")).toBeTruthy();
    expect(screen.getByText("Request submitted")).toBeTruthy();
    expect(screen.getByText("Funds hold reserved")).toBeTruthy();
    expect(screen.getByText("Approvals (1 of 2)")).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("Settled & paid")).toBeTruthy();
  });

  it("renders rejection state with reason", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseTimeline
          status="rejected"
          amountPaise={paise(50000)}
          payeeName="Ramesh Electricals"
          createdAt="2026-10-28 10:00 AM"
          submittedAt="2026-10-28 10:05 AM"
          rejectedAt="2026-10-28 10:30 AM"
          rejectionReason="Over budget for this month"
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("Reason: Over budget for this month")).toBeTruthy();
  });

  it("renders completed settled state", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ExpenseTimeline
          status="settled"
          amountPaise={paise(50000)}
          payeeName="Ramesh Electricals"
          createdAt="2026-10-28 10:00 AM"
          submittedAt="2026-10-28 10:05 AM"
          settledAt="2026-10-28 11:00 AM"
          requiredQuorum={2}
          approvals={[
            { approverId: "user-1", approverName: "Approver 1", approvedAt: "10:15" },
            { approverId: "user-2", approverName: "Approver 2", approvedAt: "10:20" },
          ]}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Approvals (2 of 2)")).toBeTruthy();
    expect(screen.getByText("Funds released to Ramesh Electricals")).toBeTruthy();
  });

  it("renders in Hindi when Hindi locale is active", () => {
    render(
      <LocaleProvider initialLocale="hi">
        <ExpenseTimeline
          status="submitted"
          amountPaise={paise(50000)}
          payeeName="रमेश इलेक्ट्रिकल्स"
          createdAt="2026-10-28 10:00 AM"
          submittedAt="2026-10-28 10:05 AM"
          requiredQuorum={2}
          approvals={[]}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("list", { name: "अनुरोध की प्रगति" })).toBeTruthy();
    expect(screen.getByText("ड्राफ्ट तैयार")).toBeTruthy();
    expect(screen.getByText("अनुरोध प्रस्तुत")).toBeTruthy();
    expect(screen.getByText("रकम सुरक्षित रोक ली गई")).toBeTruthy();
    expect(screen.getByText("स्वीकृतियाँ (0 / 2)")).toBeTruthy();
    expect(screen.getByText("भुगतान संपन्न")).toBeTruthy();
  });
});
