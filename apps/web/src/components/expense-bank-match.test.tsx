import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { setApiClient } from "../lib/api-client";
import { ExpenseBankMatch } from "./expense-bank-match";

afterEach(() => {
  vi.unstubAllGlobals();
  setApiClient(null);
});
function setup({ role = "owner", matchedCount = 1, status = 200 } = {}) {
  const onMatched = vi.fn();
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      let data: unknown = { displayName: "Aarav Sharma" };
      if (url.endsWith("/expenses/expense-1"))
        data = { status: matchedCount > 0 ? "paid" : "approved" };
      if (url.endsWith("/funds"))
        data = { funds: [{ id: "fund-1", title: "Robotics", role, visibility: "public" }] };
      if (typeof input !== "string" && input.method === "POST") {
        requests.push(input.clone());
        data = status === 200 ? { matchedCount } : { error: { message: "Invalid CSV" } };
      }
      return new Response(JSON.stringify(data), {
        status: url.endsWith("/statements") ? status : 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  render(
    <LocaleProvider initialLocale="en">
      <ExpenseBankMatch expenseId="expense-1" fundId="fund-1" onMatched={onMatched} />
    </LocaleProvider>,
  );
  return { onMatched, requests };
}
async function upload() {
  const file = new File(["bank CSV"], "statement.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => "bank CSV" });
  await userEvent.upload(await screen.findByLabelText("Bank statement CSV"), file);
  const input = screen.getByLabelText("Bank statement CSV");
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected file input");
  expect(input.files?.length).toBe(1);
  const form = input.form;
  if (!form) throw new Error("Expected upload form");
  // jsdom reports uploaded files as missing; native validation is exercised in Playwright.
  fireEvent.submit(form);
}
it("imports the chosen statement with a stable idempotency key and refreshes the matched expense", async () => {
  const { onMatched, requests } = setup();
  await upload();
  await waitFor(() => expect(onMatched).toHaveBeenCalledOnce());
  expect(requests[0]?.headers.get("Idempotency-Key")).toBeTruthy();
  expect(await requests[0]?.json()).toEqual({ fundId: "fund-1", csvContent: "bank CSV" });
});
it("keeps unmatched payments visibly unpaid", async () => {
  const { onMatched } = setup({ matchedCount: 0 });
  await upload();
  expect((await screen.findByRole("status")).textContent).toContain("expense remains unpaid");
  expect(onMatched).not.toHaveBeenCalled();
});
it("shows a recoverable import error and reuses the key when retrying", async () => {
  const { requests } = setup({ status: 400 });
  await upload();
  expect((await screen.findByRole("alert")).textContent).toContain("could not be imported");
  const form = screen.getByRole("button", { name: "Import and match statement" }).closest("form");
  if (!form) throw new Error("Expected upload form");
  fireEvent.submit(form);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]?.headers.get("Idempotency-Key")).toBe(
    requests[1]?.headers.get("Idempotency-Key"),
  );
});
it("offers no bank import to an approver", async () => {
  setup({ role: "approver" });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("Bank statement CSV")).toBeNull();
});
