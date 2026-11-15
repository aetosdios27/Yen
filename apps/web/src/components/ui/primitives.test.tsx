import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LocaleProvider } from "../../i18n";
import { ApprovalPinModal } from "../approval-pin-modal";
import { Button as YenButton } from "../button";
import { Input } from "../input";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function DialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Review expense</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Approve expense</DialogTitle>
        <DialogDescription>Check the receipt before approving.</DialogDescription>
        <Input label="Approval PIN" />
      </DialogContent>
    </Dialog>
  );
}

function ApprovalExample() {
  const [open, setOpen] = useState(false);
  return (
    <LocaleProvider initialLocale="en">
      <button type="button" onClick={() => setOpen(true)}>
        Approve
      </button>
      <ApprovalPinModal isOpen={open} onClose={() => setOpen(false)} onConfirm={vi.fn()} />
    </LocaleProvider>
  );
}

describe("shared primitives", () => {
  it("returns focus from the controlled approval wrapper to its opener", async () => {
    const user = userEvent.setup();
    render(<ApprovalExample />);
    const opener = screen.getByRole("button", { name: "Approve" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Enter 6-digit approval PIN" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("labels the dialog, traps focus and returns focus after Escape", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    const trigger = screen.getByRole("button", { name: "Review expense" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Approve expense" });
    expect(await axe(dialog)).toHaveNoViolations();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a menu and activates its item with the keyboard", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Account</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps external descriptions alongside hint and validation text", () => {
    render(
      <>
        <p id="external">Enter the bank reference.</p>
        <Input
          label="Reference"
          hint="From your statement"
          error="Reference is required"
          aria-describedby="external"
        />
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Reference" });
    const ids = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps the existing loading button disabled and announced", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <LocaleProvider initialLocale="en">
        <YenButton variant="danger" loading onClick={onClick}>
          Reject expense
        </YenButton>
      </LocaleProvider>,
    );
    const button = screen.getByRole("button", { name: /Reject expense/ });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
