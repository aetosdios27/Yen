import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fundData from "../../../components/fund/data";
import { SANITIZED_DEMO_FUND } from "../../../components/fund/fixtures";
import { LocaleProvider } from "../../../i18n";
import PublicFundPage, { generateMetadata } from "./page";

describe("PublicFundPage (Server Component)", () => {
  const props = {
    params: Promise.resolve({ fundId: "robocup-2026" }),
  };

  beforeEach(() => {
    vi.spyOn(fundData, "getPublicFund").mockResolvedValue(SANITIZED_DEMO_FUND);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates complete OpenGraph and Twitter metadata for link previews", async () => {
    const metadata = await generateMetadata(props);

    expect(metadata.title).toBe("RoboCup 2026 Asia Fund · IIT Delhi Robotics Club · Yen");
    expect(metadata.description).toContain("Current balance: ₹1,81,500.00");

    const og = metadata.openGraph as Record<string, unknown> | undefined;
    expect(og).toBeDefined();
    expect(og?.title).toBe("RoboCup 2026 Asia Fund · IIT Delhi Robotics Club · Yen");
    expect(og?.type).toBe("website");
    expect(og?.url).toBe("/funds/robocup-2026");
    expect(og?.images).toBeDefined();

    const twitter = metadata.twitter as Record<string, unknown> | undefined;
    expect(twitter).toBeDefined();
    expect(twitter?.card).toBe("summary_large_image");
  });

  it("renders the public fund page content without authentication", async () => {
    const PageComponent = await PublicFundPage(props);

    render(<LocaleProvider initialLocale="en">{PageComponent}</LocaleProvider>);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("RoboCup 2026 Asia Fund");

    expect(screen.getByText("Total raised")).not.toBeNull();
    expect(screen.getByText("Live transparency timeline")).not.toBeNull();
  });

  it("returns fallback metadata when fund is not found", async () => {
    vi.spyOn(fundData, "getPublicFund").mockResolvedValueOnce(null);
    const metadata = await generateMetadata({ params: Promise.resolve({ fundId: "nonexistent" }) });

    expect(metadata.title).toBe("Fund Not Found · Yen");
  });
});
