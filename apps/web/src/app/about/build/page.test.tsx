import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../../i18n";
import { runAxe } from "../../../test/a11y";
import BuildPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(locale: "en" | "hi" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <BuildPage />
    </LocaleProvider>,
  );
}

it("shows current API build information and matching release links", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.yen.example");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        gitSha: "0123456789abcdef0123456789abcdef01234567",
        buildId: "abcdef0123456789abcdef0123456789abcdef01",
        artifactDigest: "sha256:abc",
        releaseTag: "v1.2.3",
      }),
    }),
  );
  renderPage();
  expect(await screen.findByText("0123456789abcdef0123456789abcdef01234567")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Matching GitHub release" }).getAttribute("href"),
  ).toContain("/releases/tag/v1.2.3");
  expect(
    screen.getByRole("link", { name: "Build record for this commit" }).getAttribute("href"),
  ).toContain("/attestations");
});

it("plainly reports an unavailable API in English and Hindi", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.yen.example");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  renderPage();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "The API version could not be reached",
    ),
  );
  cleanup();
  renderPage("hi");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("अभी API तक पहुँचा नहीं जा सका"),
  );
});

it("has no axe violations in English or Hindi", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.yen.example");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const english = renderPage();
  await screen.findByRole("status");
  expect(await runAxe(english.container)).toHaveNoViolations();
  cleanup();
  const hindi = renderPage("hi");
  await screen.findByRole("status");
  expect(await runAxe(hindi.container)).toHaveNoViolations();
});
