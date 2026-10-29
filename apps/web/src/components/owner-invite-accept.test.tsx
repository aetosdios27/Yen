import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { OwnerInviteAccept } from "./owner-invite-accept";

const mockGet = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockGet,
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockGet.mockReturnValue("valid-code-123");
});

it("shows alert message when code param is missing", () => {
  mockGet.mockReturnValue(null);
  render(<OwnerInviteAccept />);
  expect(screen.getByRole("alert").textContent).toContain("incomplete");
});

it("submits name and phone to redeem invite", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: "authenticated" }),
  } as Response);

  render(<OwnerInviteAccept />);
  await user.type(screen.getByLabelText("Name"), "Priya Sharma");
  await user.type(screen.getByLabelText("Phone number"), "+919876543210");
  await user.click(screen.getByRole("button", { name: "Accept invite" }));

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/v1/auth/owner-invites/redeem"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        code: "valid-code-123",
        phone: "+919876543210",
        displayName: "Priya Sharma",
      }),
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain("You are now an approver");
});
