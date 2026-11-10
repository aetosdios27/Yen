import type { Page } from "@playwright/test";

let inputProbe: Promise<boolean> | undefined;

/**
 * The bundled WebKit cannot dispatch pointer input on some hosts (observed on
 * macOS 26 arm64 with Playwright 1.65: every click and tap retries forever
 * reporting "html intercepts pointer events", even on a plain page, while
 * navigation, selectOption, and JS evaluation all work). Probe once per worker
 * so interaction specs skip on such hosts but keep running everywhere else,
 * including the Linux CI job.
 */
export function hostCanDispatchInput(page: Page): Promise<boolean> {
  inputProbe ??= (async () => {
    await page.setContent(`<button type="button">host input probe</button>`);
    try {
      await page.getByRole("button", { name: "host input probe" }).click({ timeout: 2_500 });
      return true;
    } catch {
      return false;
    }
  })();
  return inputProbe;
}
