import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { Input } from "./input";
import { StatusBadge } from "./status-badge";
import { Stepper } from "./stepper";
import { Timeline } from "./timeline";
import { Toast } from "./toast";

it("links the input label, hint and live error", () => {
  render(<Input label="Phone" hint="Help text" error="Enter a number" />);

  const input = screen.getByLabelText("Phone");
  expect(input.getAttribute("aria-invalid")).toBe("true");

  const describedBy = input.getAttribute("aria-describedby");
  expect(describedBy).not.toBeNull();
  const ids = (describedBy ?? "").split(" ");
  expect(ids).toHaveLength(2);
  for (const id of ids) {
    expect(document.getElementById(id)).not.toBeNull();
  }

  const alert = screen.getByRole("alert");
  expect(alert.getAttribute("aria-live")).toBe("assertive");
  expect(alert.textContent).toBe("Enter a number");
});

it("renders record history as an ordered list", () => {
  render(
    <Timeline
      label="Record history"
      items={[
        {
          id: "donation",
          title: "Donation received",
          dateTime: "2026-10-24T10:30:00+05:30",
          timestamp: "24 Oct 2026, 10:30",
        },
      ]}
    />,
  );

  expect(screen.getByRole("list", { name: "Record history" }).tagName).toBe("OL");
});

it("marks the current step for assistive technology", () => {
  render(
    <LocaleProvider>
      <Stepper
        label="Progress"
        current={2}
        steps={[
          { id: "fund-details", label: "Fund details" },
          { id: "approvers", label: "Approvers" },
        ]}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText("Approvers").closest("li")?.getAttribute("aria-current")).toBe("step");
  expect(screen.getByText(/Step 1 of 2: Fund details Completed/)).toBeTruthy();
});

it("announces a toast politely and keeps its dismiss control outside the live region", () => {
  const { rerender } = render(
    <LocaleProvider>
      <Toast open={false} title="Saved" onClose={() => undefined} />
    </LocaleProvider>,
  );

  const initialStatus = screen.getByRole("status");
  expect(initialStatus.getAttribute("aria-live")).toBe("polite");
  expect(initialStatus.textContent).toBe("");

  rerender(
    <LocaleProvider>
      <Toast open={true} title="Saved" onClose={() => undefined} />
    </LocaleProvider>,
  );

  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toContain("Saved");
  expect(status.querySelector("button")).toBeNull();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
});

it("always renders the status word alongside a decorative icon", () => {
  render(
    <LocaleProvider>
      <StatusBadge status="unmatched" />
    </LocaleProvider>,
  );

  expect(screen.getByText("No approval found")).toBeTruthy();
  expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
