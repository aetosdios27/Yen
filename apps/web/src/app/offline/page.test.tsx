import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "./page";

describe("offline page", () => {
  it("shows the message in English and Hindi as plain content", () => {
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "You are offline" })).toBeDefined();
    expect(screen.getByText(/Yen needs a connection/)).toBeDefined();
    expect(document.querySelector('[lang="hi"]')).not.toBeNull();
  });

  it("offers try-again as an ordinary link, so it works without any script", () => {
    const { container } = render(<OfflinePage />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
    expect(container.querySelector("button")).toBeNull();
  });
});
