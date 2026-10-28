import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import Home from "./page";

it("renders the translated home copy and the review link", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );

  expect(html).toContain("<h1");
  expect(html).toContain("Community money you can check.");
  expect(html).toContain('href="/design-system"');
});
