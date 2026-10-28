import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../../i18n";
import PublicFundPage, { generateMetadata } from "./page";

describe("PublicFundPage (Server Component)", () => {
  const props = {
    params: Promise.resolve({ fundId: "robocup-2026" }),
  };

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
});
