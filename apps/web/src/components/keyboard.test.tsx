import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { Button } from "./button";
import { Input } from "./input";
import { Toast } from "./toast";

function ToastHarness() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return <p>Closed</p>;
  }

  return <Toast title="Fund saved" onClose={() => setOpen(false)} />;
}

it("reaches controls with Tab and activates buttons with Enter and Space", async () => {
  const user = userEvent.setup();
  const clicks: string[] = [];

  render(
    <LocaleProvider>
      <main>
        <Input label="Donor name" />
        <Button onClick={() => clicks.push("enter")}>Save</Button>
        <Button variant="secondary" onClick={() => clicks.push("space")}>
          Cancel
        </Button>
      </main>
    </LocaleProvider>,
  );

  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText("Donor name"));

  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));

  await user.keyboard("{Enter}");

  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

  await user.keyboard(" ");

  expect(clicks).toEqual(["enter", "space"]);
});

it("closes a toast with Escape", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <ToastHarness />
    </LocaleProvider>,
  );

  screen.getByRole("button", { name: "Dismiss" }).focus();
  await user.keyboard("{Escape}");

  expect(screen.queryByText("Fund saved")).toBeNull();
  expect(screen.getByText("Closed")).toBeTruthy();
});
